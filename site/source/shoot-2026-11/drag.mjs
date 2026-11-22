const list = await (await fetch('http://127.0.0.1:9333/json')).json()
const page = list.find(t => t.type === 'page' && !t.url.startsWith('devtools'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise(r => { ws.onopen = r })
let id = 0; const wait = new Map()
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id) } }
const send = (method, params = {}) => new Promise(r => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const [f0, g0, f1, g1] = process.argv.slice(2).map(Number)
const r = JSON.parse((await send('Runtime.evaluate', { expression: 'JSON.stringify(document.querySelector("video").getBoundingClientRect())', returnByValue: true })).result.result.value)
const x0 = r.x + r.width * f0, y0 = r.y + r.height * g0, x1 = r.x + r.width * f1, y1 = r.y + r.height * g1
const ev = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 })
await ev('mouseMoved', x0, y0)
await ev('mousePressed', x0, y0)
for (let i = 1; i <= 12; i++) { await ev('mouseMoved', x0 + (x1 - x0) * i / 12, y0 + (y1 - y0) * i / 12); await new Promise(r => setTimeout(r, 30)) }
await ev('mouseReleased', x1, y1)
console.log('dragged', Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1)); process.exit(0)
