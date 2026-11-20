const list = await (await fetch('http://127.0.0.1:9333/json')).json()
const page = list.find(t => t.type === 'page' && !t.url.startsWith('devtools'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise(r => { ws.onopen = r })
let id = 0; const wait = new Map()
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id) } }
const send = (method, params = {}) => new Promise(r => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
// usage: node key.mjs <key> [ctrl]   e.g. node key.mjs z ctrl
const [key, mod] = process.argv.slice(2)
const modifiers = mod === 'ctrl' ? 2 : 0
const code = key.length === 1 ? 'Key' + key.toUpperCase() : key
await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, modifiers, windowsVirtualKeyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 46 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers })
console.log('key', key, mod ?? ''); process.exit(0)
