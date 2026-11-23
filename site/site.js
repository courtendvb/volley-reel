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

// The sample film: chapter buttons and the "play from here" buttons seek the one player.
;(() => {
  const v = document.getElementById('film')
  if (!v) return
  const chapters = [...document.querySelectorAll('.chapters button')]
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  document.querySelectorAll('[data-t]').forEach(b => b.addEventListener('click', () => {
    v.currentTime = Number(b.dataset.t)
    v.play().catch(() => {})
    if (b.classList.contains('seek')) v.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' })
  }))
  const mark = () => {
    let now = -1
    chapters.forEach((b, i) => { if (Number(b.dataset.t) <= v.currentTime) now = i })
    chapters.forEach((b, i) => b.setAttribute('aria-current', String(i === now)))
  }
  v.addEventListener('timeupdate', mark)
  v.addEventListener('seeked', mark)
})()

// Downloads: pick the build for this computer from the latest release, and list them all.
// A Mac's chip can only be read in Chromium browsers; elsewhere the person picks from the list.
;(() => {
  const REPO = 'courtendvb/syncscout-video-editor-releases'
  const ja = document.documentElement.lang === 'ja'
  const T = ja
    ? { win: 'Windows 版をダウンロード', arm: 'Mac 版をダウンロード（Apple シリコン）', x64: 'Mac 版をダウンロード（Intel）', mac: 'Mac 版をダウンロード', other: 'ダウンロード',
        mobile: 'インストールは、Windows か Mac のパソコンでこのページを開いて行ってください。', pick: '下から Mac の種類を選んでください。', other_note: 'Windows と Mac に対応しています。下から選んでください。', version: '最新版', mb: 'MB' }
    : { win: 'Download for Windows', arm: 'Download for Mac (Apple silicon)', x64: 'Download for Mac (Intel)', mac: 'Download for Mac', other: 'Download',
        mobile: 'To install, open this page on a Windows or Mac computer.', pick: 'Pick your Mac type below.', other_note: 'Built for Windows and Mac. Pick one below.', version: 'Latest version', mb: 'MB' }
  const mains = [...document.querySelectorAll('[data-dl-main]')]
  const notes = [...document.querySelectorAll('[data-dl-note]')]
  const links = {}
  document.querySelectorAll('[data-dl]').forEach(a => { links[a.dataset.dl] = a })
  if (!mains.length) return

  const ua = navigator.userAgent
  const uad = navigator.userAgentData
  const plat = (uad && uad.platform) || navigator.platform || ''
  const mobile = /Android|iPhone|iPad|iPod/.test(ua) || (uad && uad.mobile) || (/Mac/.test(plat) && navigator.maxTouchPoints > 1)
  const os = mobile ? 'mobile' : /Win/i.test(plat + ua) ? 'win' : /Mac/i.test(plat) ? 'mac' : 'other'

  const show = arch => {
    const key = os === 'mac' && arch ? arch : os === 'mac' ? 'mac' : os === 'win' ? 'win' : 'other'
    // A button that goes straight to the file only when we know which one; otherwise it points at the list.
    const direct = key === 'win' || key === 'arm' || key === 'x64'
    mains.forEach(b => {
      b.textContent = T[key]
      b.setAttribute('href', direct && links[key] ? links[key].getAttribute('href') : '#download')
      if (b.closest('.dl')) b.hidden = !direct
    })
    const note = os === 'mobile' ? T.mobile : key === 'mac' ? T.pick : key === 'other' ? T.other_note : ''
    notes.forEach(n => { n.textContent = note })
    Object.values(links).forEach(a => a.removeAttribute('data-rec'))
    if (direct && links[key]) links[key].setAttribute('data-rec', '')
  }
  show(null)

  if (os === 'mac' && uad && uad.getHighEntropyValues) {
    uad.getHighEntropyValues(['architecture']).then(v => {
      if (v.architecture === 'arm') show('arm')
      else if (v.architecture === 'x86') show('x64')
    }).catch(() => {})
  }

  fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then(rel => {
      const pick = re => (rel.assets || []).find(a => re.test(a.name))
      const found = { win: pick(/setup-.*\.exe$/), arm: pick(/arm64\.dmg$/), x64: pick(/x64\.dmg$/) }
      Object.keys(found).forEach(k => {
        const a = found[k]
        if (!a || !links[k]) return
        links[k].setAttribute('href', a.browser_download_url)
        const small = links[k].querySelector('small')
        if (small) small.textContent += ` · ${Math.round(a.size / 1048576)} ${T.mb}`
      })
      document.querySelectorAll('[data-dl-version]').forEach(e => { e.textContent = `${T.version}: ${String(rel.tag_name || '').replace(/^v/, '')}` })
      // Re-point the main buttons now that the real files are known.
      const key = Object.keys(links).find(k => links[k].hasAttribute('data-rec'))
      if (key) mains.forEach(b => b.setAttribute('href', links[key].getAttribute('href')))
    })
    .catch(() => { /* the links already open the releases page */ })
})()

// Copy buttons next to a command (the Mac Terminal install line).
;(() => {
  document.querySelectorAll('[data-copy]').forEach(b => {
    const src = b.parentElement && b.parentElement.querySelector('[data-copy-src]')
    if (!src || !navigator.clipboard) { b.hidden = true; return }
    const label = b.textContent
    b.addEventListener('click', () => {
      navigator.clipboard.writeText(src.textContent).then(() => {
        b.textContent = b.dataset.copied || 'Copied'
        setTimeout(() => { b.textContent = label }, 2000)
      }).catch(() => {})
    })
  })
})()
