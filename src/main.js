;(function () {
  'use strict'

  // ---------- Config ----------
  // Заглушка URL (поменяйте позже)
  var POST_URL = '/api/scan'
  var POST_TIMEOUT_MS = 7000
  var CAMERA_TIMEOUT_MS = 8000

  // ---------- State ----------
  var state = {
    mode: 'TEST',
    lastCode: null,
    lastMode: null,
    liveCode: null,

    // TEST flow: need two codes
    testStep: 1,
    testAssembly: null,
    testLocation: null
  }

  // ---------- DOM ----------
  var modeTestBtn = document.getElementById('modeTest')
  var modeFinalBtn = document.getElementById('modeFinal')
  var scanBtn = document.getElementById('scanBtn')

  var liveCodeEl = document.getElementById('liveCode')
  var scanResultEl = document.getElementById('scanResult')
  var sendStatusEl = document.getElementById('sendStatus')

  function setText(el, text) {
    if (!el) return
    el.textContent = String(text)
  }

  function setMode(mode) {
    var nextMode = mode === 'FINAL' ? 'FINAL' : 'TEST'
    var changed = nextMode !== state.mode
    state.mode = nextMode

    // Reset TEST flow only when entering/leaving TEST
    if (changed) {
      state.testStep = 1
      state.testAssembly = null
      state.testLocation = null
    }

    if (modeTestBtn) {
      if (state.mode === 'TEST') modeTestBtn.classList.add('is-active')
      else modeTestBtn.classList.remove('is-active')
    }

    if (modeFinalBtn) {
      if (state.mode === 'FINAL') modeFinalBtn.classList.add('is-active')
      else modeFinalBtn.classList.remove('is-active')
    }

    updateScanButtonLabel()
  }

  function setSendStatus(text) {
    setText(sendStatusEl, text)
  }

  function setScanResult(text) {
    setText(scanResultEl, text || '—')
    state.lastCode = text || null
    state.lastMode = state.mode
  }

  function setLiveCode(code) {
    setText(liveCodeEl, code || '—')
    state.liveCode = code || null
  }

  function updateScanButtonLabel() {
    if (!scanBtn) return

    if (state.mode === 'TEST') {
      scanBtn.textContent = state.testStep === 1 ? 'Сканировать сборку' : 'Сканировать место'
      return
    }

    scanBtn.textContent = 'Сканировать'
  }

  function resetTestFlow() {
    state.testStep = 1
    state.testAssembly = null
    state.testLocation = null
    updateScanButtonLabel()
  }

  function nowIso() {
    try {
      return new Date().toISOString()
    } catch (e) {
      return String(+new Date())
    }
  }

  function isAndroidBridgeAvailable() {
    return !!(window.Android && typeof window.Android.startScan === 'function')
  }

  function isAndroidCommitAvailable() {
    return !!(window.Android && typeof window.Android.commitScan === 'function')
  }

  function mockScan(mode) {
    setSendStatus('Сканирование (mock)...')
    var code = 'MOCK-' + String(Math.floor(100000 + Math.random() * 900000))

    setTimeout(function () {
      if (typeof window.onScanResult === 'function') {
        window.onScanResult(code, mode)
      }
    }, 600)
  }

  function postPayload(payload) {
    payload = payload || {}
    if (!payload.timestamp) payload.timestamp = nowIso()

    setSendStatus('Отправка...')

    var done = false
    var timedOut = false
    var controller = null
    var timeoutId = null

    if (window.AbortController) {
      controller = new window.AbortController()
      timeoutId = setTimeout(function () {
        timedOut = true
        try {
          controller.abort()
        } catch (e) {
          // ignore
        }
        setSendStatus('Таймаут отправки')
      }, POST_TIMEOUT_MS)
    } else {
      timeoutId = setTimeout(function () {
        timedOut = true
        if (!done) setSendStatus('Таймаут отправки')
      }, POST_TIMEOUT_MS)
    }

    var opts = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }
    if (controller) opts.signal = controller.signal

    return fetch(POST_URL, opts)
      .then(function (res) {
        done = true
        if (timeoutId) clearTimeout(timeoutId)
        if (timedOut) return

        if (!res || !res.ok) {
          var status = res && typeof res.status === 'number' ? res.status : 'unknown'
          setSendStatus('Ошибка отправки: HTTP ' + status)
          return
        }
        setSendStatus('Отправлено: HTTP ' + res.status)
      })
      .catch(function (err) {
        done = true
        if (timeoutId) clearTimeout(timeoutId)
        if (timedOut) return

        var msg = err && err.message ? err.message : String(err)
        // Some engines throw on abort with generic message.
        if (msg && (String(msg).toLowerCase().indexOf('abort') !== -1 || String(msg).toLowerCase().indexOf('aborted') !== -1)) {
          setSendStatus('Таймаут отправки')
          return
        }
        setSendStatus('Ошибка отправки: ' + msg)
      })
  }

  // ---------- Android callback (global) ----------
  // Native code should call: window.onScanResult(code, mode)
  window.onScanResult = function (code, mode) {
    var resolvedMode = mode || state.mode

    if (resolvedMode === 'TEST') {
      // Treat native callback as a scan event in TEST flow
      if (state.testStep === 1) {
        state.testAssembly = code
        state.testStep = 2
        updateScanButtonLabel()
        setScanResult('Сборка: ' + state.testAssembly + '\nМесто: —')
        setSendStatus('Ожидание: сканируйте место')
        return
      }

      state.testLocation = code
      var payload = {
        mode: 'TEST',
        assembly: state.testAssembly,
        location: state.testLocation
      }

      setScanResult('Сборка: ' + state.testAssembly + '\nМесто: ' + state.testLocation)
      postPayload(payload)
      resetTestFlow()
      return
    }

    // FINAL: single-code commit
    setMode('FINAL')
    setScanResult(code)
    postPayload({ code: code, mode: 'FINAL' })
  }

  // Native can continuously report current code-in-frame (no commit)
  window.onLiveCode = function (code) {
    setLiveCode(code || '—')
  }

  // Backward/Android-side compatibility: some native code calls window.onCodeUpdate(code)
  window.onCodeUpdate = function (code) {
    window.onLiveCode(code)
  }

  // ---------- Actions ----------
  function onScanClick() {
    var mode = state.mode

    // TEST mode: two-step commit
    if (mode === 'TEST') {
      if (!state.liveCode) {
        setSendStatus('Нет кода в кадре')
        return
      }

      if (state.testStep === 1) {
        state.testAssembly = state.liveCode
        state.testStep = 2
        updateScanButtonLabel()
        setScanResult('Сборка: ' + state.testAssembly + '\nМесто: —')
        setSendStatus('Ожидание: сканируйте место')
        return
      }

      // step 2
      state.testLocation = state.liveCode

      var payload = {
        mode: 'TEST',
        assembly: state.testAssembly,
        location: state.testLocation
      }

      setScanResult('Сборка: ' + state.testAssembly + '\nМесто: ' + state.testLocation)
      postPayload(payload)
      resetTestFlow()
      return
    }

    // FINAL: Save exactly what is shown as "Код в кадре".
    if (state.liveCode) {
      window.onScanResult(state.liveCode, 'FINAL')
      return
    }

    // Fallback: ask native to commit (if web doesn't have liveCode)
    if (isAndroidCommitAvailable()) {
      setSendStatus('Фиксация (native)…')
      try {
        window.Android.commitScan(mode)
      } catch (e) {
        // If native bridge throws, keep app functional
        var msg = e && e.message ? e.message : String(e)
        setSendStatus('Ошибка commitScan: ' + msg)
        if (state.liveCode) window.onScanResult(state.liveCode, mode)
      }
      return
    }

    if (isAndroidBridgeAvailable()) {
      setSendStatus('Ожидание результата от Android...')
      try {
        window.Android.startScan(mode)
      } catch (e) {
        setSendStatus(
          'Ошибка вызова Android.startScan: ' + (e && e.message ? e.message : String(e))
        )
      }
      return
    }

    mockScan(mode)
  }

  // ---------- Dev reload (no ES modules) ----------
  // Works with Vite dev server: reload page on update/full-reload.
  function setupDevReload() {
    var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    var wsUrl = protocol + '//' + location.host + '/'

    try {
      var ws = new WebSocket(wsUrl, 'vite-hmr')

      ws.onmessage = function (ev) {
        try {
          var data = JSON.parse(ev.data)
          if (!data || !data.type) return
          if (data.type === 'update' || data.type === 'full-reload') {
            location.reload()
          }
        } catch (e) {
          // ignore
        }
      }
    } catch (e) {
      // ignore
    }
  }

  // ---------- Wire up ----------
  if (modeTestBtn) modeTestBtn.addEventListener('click', function () { setMode('TEST') })
  if (modeFinalBtn) modeFinalBtn.addEventListener('click', function () { setMode('FINAL') })
  if (scanBtn) scanBtn.addEventListener('click', onScanClick)

  // Init UI
  setMode('TEST')
  setScanResult('—')
  setLiveCode('—')
  setSendStatus('Ожидание')
  updateScanButtonLabel()
  setupDevReload()
})()
