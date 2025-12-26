;(function () {
  'use strict'

  var mode = (window.RESULTS_MODE === 'FINAL') ? 'FINAL' : 'TEST'

  var rowsEl = document.getElementById('rows')
  var countEl = document.getElementById('count')
  var rtStatusEl = document.getElementById('rtStatus')

  function setText(el, text) {
    if (!el) return
    el.textContent = String(text)
  }

  function esc(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function addRow(item, toTop) {
    if (!rowsEl) return

    var ts = item && item.timestamp ? String(item.timestamp) : ''
    var m = item && item.mode ? String(item.mode) : ''
    var code = item && item.code ? String(item.code) : ''
    var assembly = item && item.assembly ? String(item.assembly) : ''
    var location = item && item.location ? String(item.location) : ''

    var tr = document.createElement('tr')
    if (mode === 'TEST') {
      tr.innerHTML =
        '<td>' + esc(ts) + '</td>' +
        '<td>' + esc(m) + '</td>' +
        '<td class="code">' + esc(assembly) + '</td>' +
        '<td class="code">' + esc(location) + '</td>'
    } else {
      tr.innerHTML =
        '<td>' + esc(ts) + '</td>' +
        '<td class="code">' + esc(code) + '</td>' +
        '<td>' + esc(m) + '</td>'
    }

    if (toTop && rowsEl.firstChild) rowsEl.insertBefore(tr, rowsEl.firstChild)
    else rowsEl.appendChild(tr)

    setText(countEl, rowsEl.children.length)
  }

  function clearRows() {
    if (!rowsEl) return
    rowsEl.innerHTML = ''
    setText(countEl, 0)
  }

  function loadInitial() {
    setText(rtStatusEl, 'загрузка…')
    return fetch('/api/scans?mode=' + encodeURIComponent(mode))
      .then(function (res) {
        if (!res || !res.ok) throw new Error('HTTP ' + (res ? res.status : 'unknown'))
        return res.json()
      })
      .then(function (list) {
        clearRows()
        if (list && list.length) {
          for (var i = 0; i < list.length; i++) {
            addRow(list[i], false)
          }
        }
        setText(rtStatusEl, 'онлайн')
      })
      .catch(function (err) {
        setText(rtStatusEl, 'ошибка загрузки: ' + (err && err.message ? err.message : String(err)))
      })
  }

  function connectStream() {
    if (!window.EventSource) {
      setText(rtStatusEl, 'SSE недоступен')
      return
    }

    var es = new EventSource('/api/stream?mode=' + encodeURIComponent(mode))

    es.onopen = function () {
      setText(rtStatusEl, 'онлайн')
    }

    es.onmessage = function (ev) {
      try {
        var data = JSON.parse(ev.data)
        if (!data) return
        addRow(data, true)
      } catch (e) {
        // ignore
      }
    }

    es.onerror = function () {
      setText(rtStatusEl, 'переподключение…')
    }
  }

  loadInitial().then(connectStream)
})()
