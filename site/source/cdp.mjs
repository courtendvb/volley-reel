// Minimal CDP driver: node cdp.mjs eval "<js>" | shot <file> | click x y
import { writeFileSync } from 'node:fs'
const list = await (await fetch('http://127.0.0.1:9333/json')).json()
const page = list.find(t => t.type === 'page' && !t.url.startsWith('devtools'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise(r => { ws.onopen = r })
let id = 0
const wait = new Map()
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id) } }
export const send = (method, params = {}) => new Promise(r => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const evalJs = async js => {
  const r = await send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true, userGesture: true })
  return r.result?.exceptionDetails ? 'ERR ' + JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails) : r.result?.result?.value
}
const [cmd, a, b] = process.argv.slice(2)
if (cmd === 'eval') console.log(typeof (await evalJs(a)) === 'string' ? await evalJs('0') && '' : '')
if (cmd === 'js') { const v = await evalJs(a); console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 0)) }
if (cmd === 'shot') {
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: +(process.env.SHOT_H ?? 900), deviceScaleFactor: 1.5, mobile: false })
  await evalJs(`(()=>{const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){if(n.textContent.trim()==='volley-reel')n.textContent='SyncScout Video Editor'}})()`)
  await new Promise(r => setTimeout(r, 900))
  const rect = await evalJs(`(()=>{const v=document.querySelector('video');if(!v)return '';const b=v.getBoundingClientRect();return JSON.stringify({x:b.x,y:b.y,w:b.width,h:b.height,vw:v.videoWidth,vh:v.videoHeight})})()`)
  writeFileSync(a + '.json', rect || '{}') // video-rect
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(a, Buffer.from(r.result.data, 'base64')); console.log('saved', a)
}
if (cmd === 'click') {
  const x = +a, y = +b
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
    await send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 })
  console.log('clicked', x, y)
}
if (cmd === 'size') {
  await send('Emulation.setDeviceMetricsOverride', { width: +a, height: +b, deviceScaleFactor: 1.5, mobile: false })
  console.log('size set')
}
ws.close()
