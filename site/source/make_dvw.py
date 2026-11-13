import random
OWN = [[5, 6, 1], [7, 8, 9], [4, 3, 2]]
OPP = [[2, 3, 4], [9, 8, 7], [1, 6, 5]]


def zone(u, v):
    c = min(2, max(0, int(u * 3)))
    r = min(5, max(0, int(v * 6)))
    return OWN[r][c] if r < 3 else OPP[r - 3][c]


def sub(u, v):
    su = u * 3 % 1
    sv = v * 6 % 1
    if v < .5:
        return ('D' if su < .5 else 'A') if sv < .5 else ('C' if su < .5 else 'B')
    return ('B' if su < .5 else 'C') if sv < .5 else ('A' if su < .5 else 'D')


def click(u, v):
    col = max(0, min(99, int((u * 3 + .5) / 4 * 100)))
    row = max(0, min(99, int((v * 6 + .5) / 7 * 100)))
    return row * 100 + col + 1


US = [('MORI', 'Haruto', 'OH'), ('KONDO', 'Sota', 'OP'), ('HAYASHI', 'Ren', 'S'), ('OGAWA', 'Yuma', 'MB'),
      ('KUDO', 'Kaito', 'OH'), ('NOGUCHI', 'Riku', 'MB'), ('ARAI', 'Shun', 'L'), ('MIURA', 'Daiki', 'OH'),
      ('SUGITA', 'Taiga', 'MB'), ('KIMURA', 'Akira', 'S'), ('ISHII', 'Hayato', 'OP'), ('OKADA', 'Minato', 'L')]
OPPS = {
    'HCF': ('Hillcrest Falcons', [('ABE', 'Kenta', 'OH'), ('ENDO', 'Yuki', 'OP'), ('FUJII', 'Sho', 'S'), ('GOTO', 'Tsubasa', 'MB'),
                                  ('HARA', 'Ryo', 'OH'), ('IDE', 'Naoki', 'MB'), ('KANO', 'Jun', 'L'), ('MATSUI', 'Koki', 'OH')]),
    'NPS': ('Northport Stars', [('NAKANO', 'Tomo', 'OH'), ('OKA', 'Yusei', 'OP'), ('SAKAI', 'Rin', 'S'), ('UENO', 'Kosei', 'MB'),
                                ('WADA', 'Hiro', 'OH'), ('YASUDA', 'Masa', 'MB'), ('TSUDA', 'Issei', 'L'), ('SHIMA', 'Ao', 'OH')]),
}
J_US = [1, 4, 7, 8, 11, 12, 5, 14, 15, 17, 18, 2]
J_OP = [2, 3, 6, 9, 10, 13, 5, 16]
SLOT = 18


def roster(team, js, pre, side):
    return [f"{side};{js[i]};{i + 1};;;;;;{pre}-{l[:3]}-{js[i]:02d};{l};{f};;{p};" for i, (l, f, p) in enumerate(team)]


def attack_target(rng, star):
    if rng.random() < .62:
        return min(.97, max(.03, rng.gauss(star[0], .09))), min(.97, max(.53, rng.gauss(star[1], .07)))
    return rng.uniform(.05, .95), rng.uniform(.55, .95)


def jo(side, j):
    return f"{side}{j:02d}"


def build(code, name, oteam, ojs, date, seed):
    r = random.Random(seed)
    out = []
    home_srv = [J_US[i] for i in (0, 4, 7, 1, 3, 5)]
    away_srv = [ojs[i] for i in (0, 1, 3, 4, 5, 7)]
    h_set, a_set = J_US[2], ojs[2]
    h_lib, a_lib = J_US[6], ojs[6]
    h_at = [(J_US[0], (.82, .82), 'V5', 'L', '4', 'H'), (J_US[4], (.14, .72), 'V5', 'L', '4', 'H'), (J_US[1], (.20, .88), 'V6', 'R', '2', 'H'),
            (J_US[3], (.55, .62), 'X1', 'C', '3', 'Q'), (J_US[7], (.75, .70), 'XP', 'P', '8', 'H')]
    a_at = [(ojs[0], (.8, .8), 'V5', 'L', '4', 'H'), (ojs[4], (.2, .7), 'V5', 'L', '4', 'H'), (ojs[1], (.25, .85), 'V6', 'R', '2', 'H'),
            (ojs[3], (.5, .6), 'X1', 'C', '3', 'Q')]
    n = 0
    target = [(25, 21), (23, 25), (25, 19), (25, 22)] if seed % 2 else [(25, 23), (25, 20), (21, 25), (25, 18)]
    for setn, (fh, fa) in enumerate(target, 1):
        h = a = 0
        hr = ar = 1
        srv = '*' if setn % 2 else 'a'
        hi = ai = 0
        while h < fh and a < fa:
            base = n * SLOT + 2
            n += 1
            win = '*' if r.random() < (fh - h) / (fh - h + fa - a) else 'a'
            rc = 'a' if srv == '*' else '*'
            sj = home_srv[hi % 6] if srv == '*' else away_srv[ai % 6]
            stype = r.choice('QQM')
            kind = r.random()
            zu = r.choice([.84, .84, .5, .16])
            su, sv = zu, -.05
            tu = r.uniform(.08, .92)
            tv = r.uniform(.60, .95)
            if sj == J_US[0]:
                tu, tv = min(.95, max(.05, r.gauss(.2, .1))), min(.97, r.gauss(.86, .06))
            ez = zone(tu, tv)
            sz = {.84: '1', .5: '6', .16: '5'}[zu]

            def add(c, st=None, en=None, sec=0):
                out.append(f"{c};;;;{st or ''};;{en or ''};10.{int(sec) // 60 % 60:02d}.{int(sec) % 60:02d};{setn};{hr};{ar};1;{int(sec)};;;;;;;;;;;;;;")

            eff = r.choice('++--!!')
            if kind < .07:
                add(f"{jo(srv, sj)}S{stype}#~~~{sz}{ez}{sub(tu, tv)}", click(su, sv), click(tu, tv), base)
                rj = h_lib if rc == '*' else a_lib
                add(f"{jo(rc, rj)}R{stype}=~~~{sz}{ez}{sub(tu, tv)}", None, None, base + 2)
                win = srv
            elif kind < .14:
                add(f"{jo(srv, sj)}S{stype}=~~~{sz}{ez}{sub(tu, tv)}", click(su, sv), click(tu, tv), base)
                win = rc
            else:
                add(f"{jo(srv, sj)}S{stype}{eff}~~~{sz}{ez}{sub(tu, tv)}", click(su, sv), click(tu, tv), base)
                rj = r.choice([h_lib, J_US[0], J_US[4]]) if rc == '*' else r.choice([a_lib, ojs[0], ojs[4]])
                rev = {'+': '+', '-': '#', '!': '!'}[eff]
                add(f"{jo(rc, rj)}R{stype}{rev}~~~{sz}{ez}{sub(tu, tv)}", None, None, base + 3)
                side = rc
                t = base + 5
                phase = 0
                while True:
                    setter = h_set if side == '*' else a_set
                    at = r.choice(h_at if side == '*' else a_at)
                    finish = phase >= 2 or r.random() < .62
                    au = {'4': .16, '2': .84, '3': .5, '8': .5}[at[4]]
                    av = .32 if at[4] == '8' else .43
                    add(f"{jo(side, setter)}E{at[5]}{r.choice('++#')}K1{at[3]}{at[4]}", None, None, t)
                    eu, ev = attack_target(r, at[1])
                    ez = zone(eu, ev)
                    other = 'a' if side == '*' else '*'
                    head = f"{jo(side, at[0])}A{at[5]}"
                    tail = f"{at[2]}~{at[4]}{ez}{sub(eu, ev)}"
                    if finish:
                        if side == win:
                            add(f"{head}#{tail}{r.choice('HHHP')}", click(au, av), click(eu, ev), t + 1)
                        elif r.random() < .45:
                            add(f"{head}/{tail}H", click(au, av), click(eu, ev), t + 1)
                            bj = J_US[3] if other == '*' else ojs[3]
                            add(f"{jo(other, bj)}B{at[5]}#", None, None, t + 1)
                        else:
                            add(f"{head}={tail}H", click(au, av), click(eu, ev), t + 1)
                        break
                    add(f"{head}-{tail}{r.choice('HT')}", click(au, av), click(eu, ev), t + 1)
                    dj = r.choice([h_lib, J_US[0], J_US[4]]) if other == '*' else r.choice([a_lib, ojs[0], ojs[4]])
                    add(f"{jo(other, dj)}D{at[5]}+~~~{at[4]}{ez}", None, None, t + 3)
                    side = other
                    t += 4
                    phase += 1
            if win == '*':
                h += 1
            else:
                a += 1
            add(f"{'*' if win == '*' else 'a'}p{h:02d}:{a:02d}", None, None, base + 15)
            if win != srv:
                if win == '*':
                    hr = hr % 6 + 1
                    hi += 1
                else:
                    ar = ar % 6 + 1
                    ai += 1
                srv = win
        out.append(f"**{setn}set;;;;;;;10.00.00;{setn};{hr};{ar};1;{n * SLOT};;;;;;;;;;;;;;")
    hdr = ["[3DATAVOLLEYSCOUT]", "FILEFORMAT: 2.0", "[3MATCH]", f"{date};18.00.00;;2026/27;;;;;1250;1;Z;;;;;", "[3TEAMS]",
           "RSH;Riverside Herons;3;Coach;Assistant;;;;;", f"{code};{name};1;Coach;Assistant;;;;;", "[3PLAYERS-H]"]
    hdr += roster(US, J_US, 'RSH', 0) + ["[3PLAYERS-V]"] + roster(oteam, ojs, code, 1)
    hdr += ["[3ATTACKCOMBINATION]", "V5;4;L;H;Outside high;;;;;", "V6;2;R;H;Opposite high;;;;;", "X1;3;C;Q;Quick;;;;;", "XP;8;P;H;Pipe;;;;;",
            "[3SETTERCALL]", "K1;;Quick front;;;;;", "[3SCOUT]"]
    return hdr + out, n


for code, seed, date, fn in (('HCF', 11, '24/10/2026', 'match1.dvw'), ('NPS', 22, '31/10/2026', 'match2.dvw')):
    nm, t = OPPS[code]
    ls, n = build(code, nm, t, J_OP, date, seed)
    with open(fn, 'w', encoding='latin1', newline='') as f:
        f.write('\r\n'.join(ls) + '\r\n')
    print(fn, len(ls), 'lines', n, 'rallies', round(n * SLOT / 60), 'min')
