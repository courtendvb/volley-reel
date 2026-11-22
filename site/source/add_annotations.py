import glob
import json

f = glob.glob('lib/projects/Riverside Herons/reels/*.json')[0]
d = json.load(open(f, encoding='utf8'))
d['markerNames'] = {'1': 'ブロックの外', '2': 'バックアタック', '3': '終盤の1本', '4': '', '5': ''}
clip = next(c for c in d['clips'].values() if c['fingerprint'].startswith('1|9-11|'))
box = {'fill': '#0F172A', 'fillOpacity': .78, 'stroke': None, 'strokeWidth': 0, 'padding': 8}
clip['annotations'] = [
    {'id': 'demo-head', 'kind': 'text', 'color': '#FFFFFF', 'x': .5, 'y': .05, 'text': '2枚ブロックの外を狙う', 'size': 36, 'bold': True, 'box': box, 'align': 'center', 'quick': True},
    {'id': 'demo-block', 'kind': 'circle', 'color': '#EF4444', 'x': .465, 'y': .225, 'w': .115, 'h': .335, 'width': 6},
    {'id': 'demo-arrow', 'kind': 'arrow', 'color': '#FFFFFF', 'x1': .425, 'y1': .27, 'x2': .695, 'y2': .455, 'width': 6},
    {'id': 'demo-note', 'kind': 'text', 'color': '#FFFFFF', 'x': .715, 'y': .43, 'text': 'ここが空く', 'size': 28, 'bold': True, 'box': box},
]
json.dump(d, open(f, 'w', encoding='utf8'), ensure_ascii=False, indent=2)
print('clip', clip['id'], 'annotations', len(clip['annotations']))

s = open('cdp.mjs', encoding='utf8').read()
if 'video-rect' not in s:
    s = s.replace("""  await new Promise(r => setTimeout(r, 900))
  const r = await send('Page.captureScreenshot'""", """  await evalJs(`(()=>{const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){if(n.textContent.trim()==='volley-reel')n.textContent='SyncScout Video Editor'}})()`)
  await new Promise(r => setTimeout(r, 900))
  const rect = await evalJs(`(()=>{const v=document.querySelector('video');if(!v)return '';const b=v.getBoundingClientRect();return JSON.stringify({x:b.x,y:b.y,w:b.width,h:b.height,vw:v.videoWidth,vh:v.videoHeight})})()`)
  writeFileSync(a + '.json', rect || '{}') // video-rect
  const r = await send('Page.captureScreenshot'""")
    open('cdp.mjs', 'w', encoding='utf8').write(s)
