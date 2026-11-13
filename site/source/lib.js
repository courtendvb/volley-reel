var sleep = ms => new Promise(r => setTimeout(r, ms))
var btn = t => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === t)
var check = (t, on) => { const l = [...document.querySelectorAll('label')].find(x => x.textContent.trim() === t); const c = l?.querySelector('input'); if (c && c.checked !== on) c.click(); return !!c }
var pick = (s, v) => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, v); s.dispatchEvent(new Event('change', { bubbles: true })) }
var detail = v => pick([...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'point')), v)
var pause = async () => { btn('❚❚')?.click(); await sleep(250) }
var seek = async t => { const v = document.querySelector('video'); v.currentTime = t; await sleep(900); return v.currentTime }
var row = (rx, base) => [...document.querySelectorAll('.play-row')].find(r => rx.test(r.textContent))
