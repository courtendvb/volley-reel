var sleep = ms => new Promise(r => setTimeout(r, ms))
var btn = t => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === t)
var check = (t, on) => { const l = [...document.querySelectorAll('label')].find(x => x.textContent.trim() === t); const c = l?.querySelector('input'); if (c && c.checked !== on) c.click(); return !!c }
var pick = (s, v) => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, v); s.dispatchEvent(new Event('change', { bubbles: true })) }
var detail = v => pick([...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'point')), v)
var pause = async () => { const v = document.querySelector('video'); v.pause(); btn('❚❚')?.click(); await sleep(250) }
var seek = async t => { const v = document.querySelector('video'); v.currentTime = t; await sleep(1200); return v.currentTime }
var rows = rx => [...document.querySelectorAll('.play-row')].filter(r => rx.test(r.textContent))
var listBox = () => { let e = document.querySelector('.play-row').parentElement; while (e && e.scrollHeight <= e.clientHeight + 5) e = e.parentElement; return e }
var findRow = async rx => { const b = listBox(); b.scrollTop = 0; await sleep(150); for (let i = 0; i < 400; i++) { const r = rows(rx)[0]; if (r) { r.scrollIntoView({ block: 'center' }); await sleep(150); return rows(rx)[0] } b.scrollTop += 300; await sleep(60) } return null }
var collect = async (rx, n = 60) => { const b = listBox(); b.scrollTop = 0; await sleep(150); const seen = new Set(); for (let i = 0; i < 400 && seen.size < n; i++) { rows(rx).forEach(r => seen.add(r.textContent.replace(/\s+/g, ' ').replace(/ 1 2 3 4 5$/, ''))); const before = b.scrollTop; b.scrollTop += 300; await sleep(60); if (b.scrollTop === before) break } return [...seen] }
