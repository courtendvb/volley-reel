#!/bin/bash
# usage: shoot.sh name 'rowRegex' 'setup js' offset   (offset: seconds after the key play)
n=$1; rx=$2; setup=$3; off=$4
cat > tmp.js <<J
$(cat lib.js)
(async()=>{ const r=await findRow($rx); if(!r) return 'norow'; r.click(); await sleep(500); const v=document.querySelector('video'); v.pause(); await sleep(300);
const t0=v.currentTime; $setup; await sleep(400); v.pause(); v.currentTime=t0+3+($off); await sleep(1800); v.pause();
[...document.querySelectorAll('.warning')].forEach(e=>e.style.display='none'); return JSON.stringify({t0,t:v.currentTime,p:v.paused})})()
J
node cdp.mjs js "$(cat tmp.js)"; SHOT_H=1000 node cdp.mjs shot shots/$n.png >/dev/null
python - "$n" <<'P'
import json,sys
from PIL import Image
n=sys.argv[1]; r=json.load(open(f'shots/{n}.png.json')); i=Image.open(f'shots/{n}.png').convert('RGB'); s=1.5
fit=min(r['w']/r['vw'],r['h']/r['vh']); w,h=r['vw']*fit,r['vh']*fit; x,y=r['x']+(r['w']-w)/2,r['y']+(r['h']-h)/2
c=i.crop((round(x*s),round(y*s),round((x+w)*s),round((y+h)*s))); c.save(f'shots/{n}.jpg',quality=88); print(n,c.size)
P
