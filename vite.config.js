import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function scanApiPlugin() {
  /** @type {{ TEST: any[], FINAL: any[] }} */
  const tables = { TEST: [], FINAL: [] }
  /** @type {{ TEST: Set<import('http').ServerResponse>, FINAL: Set<import('http').ServerResponse> }} */
  const streams = { TEST: new Set(), FINAL: new Set() }

  function sendJson(res, status, data) {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(data))
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let raw = ''
      req.on('data', (chunk) => {
        raw += chunk
        // basic safety limit
        if (raw.length > 1_000_000) {
          reject(new Error('Body too large'))
          try { req.destroy() } catch (e) {}
        }
      })
      req.on('end', () => resolve(raw))
      req.on('error', reject)
    })
  }

  function modeFrom(value) {
    return value === 'FINAL' ? 'FINAL' : 'TEST'
  }

  function broadcast(mode, item) {
    const payload = `data: ${JSON.stringify(item)}\n\n`
    for (const res of streams[mode]) {
      try {
        res.write(payload)
      } catch (e) {
        // drop broken stream
        try { res.end() } catch (e2) {}
        streams[mode].delete(res)
      }
    }
  }

  return {
    name: 'scan-api-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const url = new URL(req.url || '/', 'http://localhost')

          // List scans
          if (req.method === 'GET' && url.pathname === '/api/scans') {
            const mode = modeFrom(url.searchParams.get('mode'))
            return sendJson(res, 200, tables[mode])
          }

          // SSE stream
          if (req.method === 'GET' && url.pathname === '/api/stream') {
            const mode = modeFrom(url.searchParams.get('mode'))
            res.statusCode = 200
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
            res.setHeader('Cache-Control', 'no-cache, no-transform')
            res.setHeader('Connection', 'keep-alive')
            res.setHeader('X-Accel-Buffering', 'no')
            // Initial comment to establish stream
            res.write(': connected\n\n')

            streams[mode].add(res)
            req.on('close', () => {
              streams[mode].delete(res)
            })
            return
          }

          // Receive scan
          if (req.method === 'POST' && url.pathname === '/api/scan') {
            const raw = await readBody(req)
            let body
            try {
              body = raw ? JSON.parse(raw) : {}
            } catch (e) {
              return sendJson(res, 400, { ok: false, error: 'Invalid JSON' })
            }

            const mode = modeFrom(body && body.mode)
            const timestamp = body && body.timestamp != null ? String(body.timestamp) : new Date().toISOString()

            let item

            if (mode === 'TEST') {
              const assembly = body && body.assembly != null ? String(body.assembly) : ''
              const location = body && body.location != null ? String(body.location) : ''

              if (!assembly || !location) {
                return sendJson(res, 400, { ok: false, error: 'Missing assembly/location' })
              }

              item = { mode, timestamp, assembly, location }
            } else {
              const code = body && body.code != null ? String(body.code) : ''
              if (!code) {
                return sendJson(res, 400, { ok: false, error: 'Missing code' })
              }
              item = { code, mode, timestamp }
            }

            tables[mode].push(item)

            // Keep memory bounded
            if (tables[mode].length > 2000) tables[mode].splice(0, tables[mode].length - 2000)

            broadcast(mode, item)
            return sendJson(res, 200, { ok: true })
          }
        } catch (e) {
          // fall through
        }

        next()
      })
    }
  }
}

export default defineConfig({
  plugins: [scanApiPlugin()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    hmr: {
      // Helps Android WebView + LAN setups where the client must connect back to the same port.
      clientPort: 5173
    }
  },
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        results: resolve(__dirname, 'results.html'),
        test: resolve(__dirname, 'test.html'),
        final: resolve(__dirname, 'final.html')
      }
    }
  },
  preview: {
    host: true,
    port: 4173,
    strictPort: true
  }
})
