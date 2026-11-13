# Fake matches for the site's hero: every CRO attack becomes a #10 X6 with a made-up landing.
import json, random, re, uuid, shutil, sys
src = 'cro/2022-05-28 CRO-DNK.dvw'
raw = open(src, 'rb').read().decode('latin-1').split('\n')
spots = [  # weight, u mean, u sd, v mean, v sd
  (40, .12, .09, .88, .06), (22, .88, .07, .86, .07), (18, .40, .10, .82, .06), (12, .08, .06, .66, .06), (8, .60, .15, .58, .04)]
def coord(u, v):
  col = round((u * 3 + .5) * 25 - .5); row = round((v * 6 + .5) / .07 - .5)
  return f'{row * 100 + col + 1:04d}'
starts = ['4389', '4586', '4787', '4489', '4484']
base = json.load(open('lib/matches/ffd4ef58-dbfd-434f-be14-d7d586c44599.json', encoding='utf-8'))
proj_p = 'lib/projects/Croatia 2022/project.json'; proj = json.load(open(proj_p, encoding='utf-8'))
proj['matchIds'] = proj['matchIds'][:1]
for k, date in enumerate(['2022-05-21', '2022-05-25']):
  rnd = random.Random(10 + k); out = []
  for line in raw:
    if re.match(r'\*\d\dA', line):
      c = line.split(';'); code = c[0]
      w = rnd.choices(spots, [s[0] for s in spots])[0]
      u = min(.99, max(.01, rnd.gauss(w[1], w[2]))); v = min(.99, max(.52, rnd.gauss(w[3], w[4])))
      eff = rnd.choices('#+-!=/', [45, 15, 15, 10, 10, 5])[0]
      c[0] = '*10AT' + eff + 'X6~2' + code[10:]
      c[4] = starts[rnd.randrange(5)]; c[5] = '-1-1'; c[6] = coord(u, v)
      line = ';'.join(c)
    out.append(line)
  path = f'cro/{date} CRO-DNK.dvw'
  open(path, 'wb').write('\n'.join(out).encode('latin-1'))
  m = dict(base); m['id'] = f'eeee000{k+1}-0000-4000-8000-00000000000{k+1}'; m['name'] = f'{date} CRO-DNK'; m['date'] = date
  m['dvwPath'] = base['dvwPath'].replace('2022-05-28', date)
  json.dump(m, open(f"lib/matches/{m['id']}.json", 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
  proj['matchIds'].append(m['id'])
json.dump(proj, open(proj_p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print(proj['matchIds'])
