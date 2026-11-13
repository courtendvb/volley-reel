import json
import sys
from PIL import Image

# Cut the picture out of a capture, using the video element's box and the video's own shape.
for name in sys.argv[1:]:
    r = json.load(open(f'shots/{name}.png.json'))
    i = Image.open(f'shots/{name}.png').convert('RGB')
    s = 1.5
    fit = min(r['w'] / r['vw'], r['h'] / r['vh'])
    w, h = r['vw'] * fit, r['vh'] * fit
    x, y = r['x'] + (r['w'] - w) / 2, r['y'] + (r['h'] - h) / 2
    c = i.crop((round(x * s), round(y * s), round((x + w) * s), round((y + h) * s)))
    c.save(f'shots/{name}_f.png')
    c.resize((960, round(960 * c.height / c.width))).save(f'shots/{name}_v.jpg', quality=85)
    print(name, c.size)
