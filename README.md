# Scanner App (Vite + Vanilla JS)

Минимальное web-приложение для использования внутри Android WebView через dev-сервер.

## Запуск dev-сервера

1) Установить зависимости:

- Windows PowerShell (если `npm` блокируется политикой скриптов):
  - `npm.cmd install`

2) Запустить dev-сервер (с доступом из LAN):

- `npm.cmd run dev`

Vite будет слушать `0.0.0.0:5173` (доступен с телефона/эмулятора в сети).

## URL для Android WebView

### Android Emulator (стандартный эмулятор Google)

Используйте адрес хоста через спец-IP:

- `http://10.0.2.2:5173/`

(Для Genymotion часто используется `http://10.0.3.2:5173/`.)

### Реальный телефон

Нужно, чтобы телефон и ПК были в одной сети (Wi‑Fi/LAN). Используйте IP вашего ПК в сети:

- `http://<LAN_IP_ВАШЕГО_ПК>:5173/`

Пример: `http://192.168.1.50:5173/`

Важно:
- Запускайте сервер с `--host 0.0.0.0` (уже сделано в скрипте `dev`).
- Разрешите входящие подключения в Windows Firewall для порта `5173` (если потребуется).
- Если загружаете `http://...` в Android 9+ и видите блокировку, включите cleartext-трафик в приложении (например `android:usesCleartextTraffic="true"` на время разработки).

Рекомендовано для реального телефона (чтобы камера работала в WebView без HTTPS):
- Подключите телефон по USB (USB debugging включен)
- Выполните на ПК: `adb reverse tcp:5173 tcp:5173`
- В WebView грузите: `http://127.0.0.1:5173/`

Так origin становится `localhost`, и `navigator.mediaDevices.getUserMedia` обычно доступен.

## Интеграция с Android

- При нажатии "Сканировать":
  - если доступен `window.Android.startScan(mode)` — вызывается он
  - иначе используется mock-сканирование

UI всегда показывает область "Camera preview" и "Код в кадре".

Ключевой момент про **реальный телефон без HTTPS и без adb reverse**:
- В Android WebView `navigator.mediaDevices.getUserMedia` часто **недоступен** на обычном LAN HTTP (`http://192.168.x.x:5173/`) из-за требований secure origin.
- Поэтому для режима "без https и без adb reverse" рекомендуемый способ — **native камера + WebView UI**:
  - Камера рендерится нативно (PreviewView) **под** WebView
  - WebView делается прозрачным, и камера видна в области превью
  - Native постоянно распознаёт код и пушит его в web: `window.onLiveCode(code)`
  - По нажатию "Сканировать" web вызывает `window.Android.commitScan(mode)` — native фиксирует последний распознанный код и вызывает `window.onScanResult(code, mode)`

Web-страница уже поддерживает эти функции:
- `window.onLiveCode(code)` — показать код в кадре (без фиксации)
- `window.onCodeUpdate(code)` — алиас для совместимости (если native так уже вызывает)
- `window.onScanResult(code, mode)` — зафиксировать и отправить
- `window.Android.commitScan(mode)` — запросить фиксацию у native (если реализовано)

- Native должен передавать результат обратно так:
  - `window.onScanResult(code, mode)`

## Отправка результата

После получения результата выполняется `fetch` POST на локальный dev API:

- `POST /api/scan`

Тело запроса:

```json
{ "code": "...", "mode": "TEST|FINAL", "timestamp": "..." }
```

Тело запроса:

```json
{ "code": "...", "mode": "TEST|FINAL", "timestamp": "..." }
```

Dev-сервер Vite хранит результаты в памяти и раскладывает их по таблицам по полю `mode`:
- `TEST` → таблица TEST
- `FINAL` → таблица FINAL

## Страницы результатов (real-time)

- TEST: `http://<host>:5173/test.html`
- FINAL: `http://<host>:5173/final.html`

Они получают данные:
- начальная загрузка: `GET /api/scans?mode=TEST|FINAL`
- realtime: `GET /api/stream?mode=TEST|FINAL` (SSE)
