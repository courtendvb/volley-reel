import json,sys
from PIL import Image
n,o=sys.argv[1],sys.argv[2]
i=Image.open(f'shots/{n}.png').convert('RGB'); r=json.load(open(f'shots/{n}.png.json')); s=1.5
fit=min(r['w']/r['vw'],r['h']/r['vh']);w,h=r['vw']*fit,r['vh']*fit;x,y=r['x']+(r['w']-w)/2,r['y']+(r['h']-h)/2
v=i.crop((round(x*s),round(y*s),round((x+w)*s),round((y+h)*s))); v=v.resize((1651,round(1651*v.height/v.width)),Image.LANCZOS); v.save(f'out/{o}.jpg',quality=88); print(o,v.size)
