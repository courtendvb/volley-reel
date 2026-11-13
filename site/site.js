(() => {
  const tabs = [...document.querySelectorAll('.tab')]
  const pics = [...document.querySelectorAll('#stage img')]
  const show = tab => {
    tabs.forEach(t => t.setAttribute('aria-selected', String(t === tab)))
    pics.forEach(p => p.classList.toggle('on', p.dataset.layer === tab.dataset.layer))
  }
  tabs.forEach((t, i) => {
    t.tabIndex = i === 0 ? 0 : -1
    t.addEventListener('click', () => { tabs.forEach(x => { x.tabIndex = -1 }); t.tabIndex = 0; show(t) })
    t.addEventListener('keydown', e => {
      const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key]
      if (!step) return
      e.preventDefault()
      const next = tabs[(i + step + tabs.length) % tabs.length]
      next.focus(); next.click()
    })
  })
})()

// The hero loop stays still for people who ask for less motion; they get the controls instead.
;(() => {
  const v = document.querySelector('.hero-video')
  if (!v || !window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  v.removeAttribute('autoplay')
  v.pause()
  v.controls = true
})()
