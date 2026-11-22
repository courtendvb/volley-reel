import glob
import json

for f in glob.glob('lib/matches/*.json'):
    m = json.load(open(f, encoding='utf8'))
    m['court']['corners'] = [{'x': .310, 'y': .462}, {'x': .711, 'y': .462}, {'x': .033, 'y': .880}, {'x': .992, 'y': .895}]
    json.dump(m, open(f, 'w', encoding='utf8'), ensure_ascii=False, indent=2)
print('ok')
