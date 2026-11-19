# Fictional DataVolley files for the site's screenshots: four matches of the Riverside Herons,
# with lineups on every line (P1..P6), rotations that turn the right way, set clicks, setter calls
# and roles, so the reports, the 分析 window and the rotation slides have something to show.
# Usage: python make_demo_dvw.py <out dir>
import os
import random
import sys

OWN = [[5, 6, 1], [7, 8, 9], [4, 3, 2]]
OPP = [[2, 3, 4], [9, 8, 7], [1, 6, 5]]
SLOT = 27  # seconds of video per rally


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
    return f"{row * 100 + col + 1:04d}"


ROLE_NO = {'L': 1, 'OH': 2, 'OP': 3, 'MB': 4, 'S': 5}

# (jersey, last, first, role); the first six are the starting lineup P1..P6: S, OH1, MB2, OP, OH2, MB1.
TEAMS = {
    'RSH': ('Riverside Herons', 'Coach Ito', 'Assistant Sato', 1.10, [
        (3, 'HAYASHI', 'Ren', 'S'), (1, 'MORI', 'Haruto', 'OH'), (12, 'NOGUCHI', 'Riku', 'MB'), (8, 'KONDO', 'Sota', 'OP'),
        (11, 'KUDO', 'Kaito', 'OH'), (4, 'OGAWA', 'Yuma', 'MB'), (5, 'ARAI', 'Shun', 'L'), (14, 'MIURA', 'Daiki', 'OH'),
        (15, 'SUGITA', 'Taiga', 'MB'), (17, 'KIMURA', 'Akira', 'S'), (18, 'ISHII', 'Hayato', 'OP'), (2, 'OKADA', 'Minato', 'L')]),
    'HCF': ('Hillcrest Falcons', 'Coach Abe', 'Assistant Oda', 1.0, [
        (6, 'FUJII', 'Sho', 'S'), (2, 'ABE', 'Kenta', 'OH'), (10, 'IDE', 'Naoki', 'MB'), (3, 'ENDO', 'Yuki', 'OP'),
        (13, 'HARA', 'Ryo', 'OH'), (9, 'GOTO', 'Tsubasa', 'MB'), (5, 'KANO', 'Jun', 'L'), (16, 'MATSUI', 'Koki', 'OH')]),
    'NPS': ('Northport Stars', 'Coach Ueda', 'Assistant Mori', .98, [
        (7, 'SAKAI', 'Rin', 'S'), (4, 'NAKANO', 'Tomo', 'OH'), (11, 'YASUDA', 'Masa', 'MB'), (9, 'OKA', 'Yusei', 'OP'),
        (15, 'WADA', 'Hiro', 'OH'), (12, 'UENO', 'Kosei', 'MB'), (1, 'TSUDA', 'Issei', 'L'), (18, 'SHIMA', 'Ao', 'OH')]),
    'LKW': ('Lakeview Wolves', 'Coach Kato', 'Assistant Ono', 1.04, [
        (2, 'TANI', 'Kei', 'S'), (10, 'MAEDA', 'Ryota', 'OH'), (5, 'SHIBA', 'Gaku', 'MB'), (11, 'ODA', 'Takumi', 'OP'),
        (7, 'KOGA', 'Yuto', 'OH'), (14, 'NAGAI', 'Sora', 'MB'), (19, 'IWATA', 'Rei', 'L'), (8, 'HONDA', 'Kai', 'OH')]),
}

COMBOS = ["V5;4;L;H;Outside high;;;;;", "V6;2;R;H;Opposite high;;;;;", "V8;1;R;H;Back right high;;;;;",
          "X5;4;L;Q;Outside fast;;;;;", "X1;3;C;Q;Quick front;;;;;", "X2;3;C;Q;Quick behind;;;;;",
          "X7;2;R;Q;Slide;;;;;", "XP;8;P;H;Pipe;;;;;"]
CALLS = ["K1;;Quick front;;;;;", "K2;;Quick behind;;;;;", "K7;;Slide;;;;;"]


class Team:
    def __init__(self, code, rng):
        self.code = code
        self.name, self.coach, self.assistant, self.power, self.roster = TEAMS[code]
        self.lineup = [p[0] for p in self.roster[:6]]
        self.role = {p[0]: p[3] for p in self.roster}
        self.setter = self.lineup[0]
        self.libero = next(p[0] for p in self.roster if p[3] == 'L')
        # Each server keeps a serve type and a favourite target.
        self.serve = {j: (rng.choice('QQM'), rng.choice([1, 1, 5, 6]), (rng.uniform(.15, .85), rng.uniform(.62, .92))) for j in self.lineup}
        # Each attacker keeps a favourite direction (on the far court, as if attacking upward).
        self.aim = {j: (rng.uniform(.12, .88), rng.uniform(.62, .9)) for j in self.lineup}

    def rot(self):
        return self.lineup.index(self.setter) + 1

    def turn(self):
        self.lineup = self.lineup[1:] + self.lineup[:1]


def mirror(side, u, v):
    # The app reads each click as seen by the play's own team (v: its end line 0, the net .5), so no turning.
    return u, v


def build(home, away, date, seed, spectators, hall):
    rng = random.Random(seed)
    deep_rng = random.Random(seed * 7919)
    H, A = Team(home, rng), Team(away, rng)
    team = {'*': H, 'a': A}
    out = []
    t = 30
    sets_won = {'*': 0, 'a': 0}
    set_rows = []
    starts = {'*': [], 'a': []}
    setn = 0
    while max(sets_won.values()) < 3:
        setn += 1
        # A new set: the starting lineup comes back, a different rotation each set.
        for s, tm in team.items():
            tm.lineup = [p[0] for p in tm.roster[:6]]
            for _ in range(rng.choice([0, 0, 1, 2, 3, 4, 5])):
                tm.turn()
            starts[s].append({j: i + 1 for i, j in enumerate(tm.lineup)})
        score = {'*': 0, 'a': 0}
        srv = '*' if setn % 2 else 'a'
        partials = []
        set_start = t
        while True:
            def add(code, st='', en=''):
                cols = [code, '', '', '', st, '', en, f"10.{t // 60 % 60:02d}.{t % 60:02d}", str(setn), str(H.rot()), str(A.rot()), '1', str(t), '']
                cols += [str(j) for j in H.lineup] + [str(j) for j in A.lineup]
                out.append(';'.join(cols) + ';')

            base = t
            rc = 'a' if srv == '*' else '*'
            S, R = team[srv], team[rc]
            sj = S.lineup[0]
            stype, szone, aim = S.serve[sj]
            su = {1: .84, 6: .5, 5: .16}[szone]
            # Serves land mostly deep, in zones 1, 6 and 5 (v over .83). The draws from rng stay as
            # they were so the rest of the match comes out the same; deep() reshapes them, and a
            # separate stream (deep_rng) decides which of the old short serves stay short.
            deep = lambda v: .84 + (v - .62) / .30 * .11  # the old aim, .62-.92, onto .84-.95
            tu = min(.95, max(.05, rng.gauss(aim[0], .14)))
            tv = min(.98, max(.53, deep(aim[1]) + (rng.gauss(aim[1], .08) - aim[1]) * .5))
            if rng.random() < .25:  # short serves: about one in three of these stays short
                su_, sv_ = rng.uniform(.1, .9), rng.uniform(.53, .64)
                if deep_rng.random() < .3:
                    tu, tv = su_, sv_
            (a0, b0), (a1, b1) = mirror(srv, su, -.04), mirror(srv, tu, tv)
            ez, es = zone(a1, b1), sub(a1, b1)
            ace = rng.random() < .06 * S.power
            miss = not ace and rng.random() < .13
            win = None
            if miss:
                add(f"{srv}{sj:02d}S{stype}=~~~{szone}{ez}{es}", click(a0, b0), click(a1, b1))
                win = rc
            else:
                rev = '=' if ace else rng.choices('#+!-/', [26, 24, 20, 17, 5])[0]
                ev = {'=': '#', '#': '-', '+': '-', '!': '!', '-': '+', '/': '/'}[rev]
                add(f"{srv}{sj:02d}S{stype}{ev}~~~{szone}{ez}{es}", click(a0, b0), click(a1, b1))
                back = [j for j in R.lineup if R.role[j] == 'OH'] + [R.libero, R.libero]
                rj = rng.choice(back)
                t += 1
                add(f"{rc}{rj:02d}R{stype}{rev}~~~{szone}{ez}{es}")
                if rev == '=':
                    win = srv
                else:
                    side, phase, quality = rc, 0, rev
                    if rev == '/':
                        side, quality = srv, '-'
                    while win is None:
                        tm, other = team[side], team['a' if side == '*' else '*']
                        osd = 'a' if side == '*' else '*'
                        front = tm.lineup[1:4]
                        backrow = [tm.lineup[0], tm.lineup[4], tm.lineup[5]]
                        opts = []
                        for j in front:
                            r = tm.role[j]
                            if r == 'OH':
                                opts += [(j, 'V5', 34), (j, 'X5', 6)]
                            elif r == 'OP':
                                opts += [(j, 'V6', 30)]
                            elif r == 'MB' and quality in '#+':
                                opts += [(j, 'X1', 14), (j, 'X2', 5), (j, 'X7', 4)]
                        for j in backrow:
                            r = tm.role[j]
                            if r == 'OP':
                                opts += [(j, 'V8', 14)]
                            elif r == 'OH' and quality in '#+':
                                opts += [(j, 'XP', 9)]
                        j, combo, _ = rng.choices(opts, [o[2] for o in opts])[0]
                        czone = {'V5': 4, 'X5': 4, 'V6': 2, 'V8': 1, 'X1': 3, 'X2': 3, 'X7': 2, 'XP': 8}[combo]
                        tempo = 'Q' if combo[0] == 'X' and combo != 'XP' else 'H'
                        call = {'X1': 'K1', 'X2': 'K2', 'X7': 'K7'}.get(combo) or rng.choices(['K1', 'K2', 'K7'], [6, 3, 2])[0]
                        target = {4: 'F', 3: 'C', 2: 'B', 1: 'B', 8: 'P'}[czone]
                        setter = tm.setter if tm.setter != j else tm.lineup[1]
                        su2, sv2 = rng.gauss(.6, .04), rng.gauss(.43, .015) if quality in '#+' else rng.uniform(.3, .42)
                        x, y = mirror(side, su2, sv2)
                        t += 2
                        add(f"{side}{setter:02d}E{tempo}{rng.choice('##+')}{call}{target}{zone(x, y)}", click(x, y))
                        au = {4: .14, 3: .5, 2: .86, 1: .84, 8: .5}[czone] + rng.gauss(0, .03)
                        av = .3 if czone in (1, 8) else .44
                        aim = tm.aim.get(j, (.5, .75))
                        eu = min(.97, max(.03, rng.gauss(aim[0], .17)))
                        evv = min(.97, max(.54, rng.gauss(aim[1], .09)))
                        (x0, y0), (x1, y1) = mirror(side, au, av), mirror(side, eu, evv)
                        az, asb = zone(x1, y1), sub(x1, y1)
                        kill = {'#': .56, '+': .52, '!': .42, '-': .36}[quality] * tm.power / other.power
                        roll = rng.random()
                        hit = rng.choice('HHHHHPT')
                        t += 1
                        if roll < kill:
                            add(f"{side}{j:02d}A{tempo}#{combo}~{czone}{az}{asb}{hit}", click(x0, y0), click(x1, y1))
                            win = side
                        elif roll < kill + .09:
                            add(f"{side}{j:02d}A{tempo}={combo}~{czone}{az}{asb}H", click(x0, y0), click(x1, y1))
                            win = osd
                        elif roll < kill + .17:
                            add(f"{side}{j:02d}A{tempo}/{combo}~{czone}{az}{asb}H", click(x0, y0), click(x1, y1))
                            blk = [b for b in other.lineup[1:4]]
                            add(f"{osd}{rng.choice(blk):02d}B{tempo}#")
                            win = osd
                        else:
                            add(f"{side}{j:02d}A{tempo}{rng.choice('-+!')}{combo}~{czone}{az}{asb}{hit}", click(x0, y0), click(x1, y1))
                            dj = rng.choice([other.libero] + [p for p in other.lineup if other.role[p] == 'OH'])
                            t += 2
                            add(f"{osd}{dj:02d}D{tempo}{rng.choice('+-#!')}~~~{czone}{az}")
                            side, quality = osd, rng.choice('+-!-')
                            phase += 1
                            if phase > 5:
                                win = side
            score[win] += 1
            t = max(t + 4, base + SLOT + rng.randint(-3, 5))
            out.append(f"{win}p{score['*']:02d}:{score['a']:02d};;;;;;;10.{t // 60 % 60:02d}.{t % 60:02d};{setn};{H.rot()};{A.rot()};1;{t};;;;;;;;;;;;;;")
            for p in (8, 16, 21):
                if max(score.values()) == p and len(partials) < [8, 16, 21].index(p) + 1:
                    partials.append(f"{score['*']}-{score['a']}")
            if win != srv:
                team[win].turn()
                srv = win
            cap = 15 if setn == 5 else 25
            if max(score.values()) >= cap and abs(score['*'] - score['a']) >= 2:
                break
        w = '*' if score['*'] > score['a'] else 'a'
        sets_won[w] += 1
        set_rows.append(f"True;{';'.join((partials + ['', '', ''])[:3])};{score['*']}-{score['a']};{(t - set_start) // 60};")
        out.append(f"**{setn}set;;;;;;;10.{t // 60 % 60:02d}.{t % 60:02d};{setn};{H.rot()};{A.rot()};1;{t};;;;;;;;;;;;;;")
        t += 180

    def roster(side, tm):
        rows = []
        for i, (j, last, first, role) in enumerate(tm.roster):
            played = []
            for st in starts[side]:
                played.append(str(st[j]) if j in st else ('*' if role == 'L' and j == tm.libero else ''))
            played += [''] * (5 - len(played))
            rows.append(f"{0 if side == '*' else 1};{j};{i + 1};{';'.join(played)};{tm.code}-{last[:3]}-{j:02d};{last};{first};;{'L' if role == 'L' else ''};{ROLE_NO[role]};False;;;;;;;;;;")
        return rows

    hdr = ["[3DATAVOLLEYSCOUT]", "FILEFORMAT: 2.0", "GENERATOR-DAY: ", "[3MATCH]", f"{date};18.00.00;2026/27;Autumn League;;;;;1252;1;Z;0;", "[3TEAMS]",
           f"{H.code};{H.name};{sets_won['*']};{H.coach};{H.assistant};;;;;", f"{A.code};{A.name};{sets_won['a']};{A.coach};{A.assistant};;;;;",
           "[3MORE]", f"K. Mizuno, T. Hara;{spectators};;Riverside;{hall};", "[3SET]"] + set_rows
    hdr += ["[3PLAYERS-H]"] + roster('*', H) + ["[3PLAYERS-V]"] + roster('a', A)
    hdr += ["[3ATTACKCOMBINATION]"] + COMBOS + ["[3SETTERCALL]"] + CALLS + ["[3SCOUT]"]
    return hdr + out, t


if __name__ == '__main__':
    out_dir = sys.argv[1] if len(sys.argv) > 1 else '.'
    os.makedirs(out_dir, exist_ok=True)
    games = [('RSH', 'HCF', '10/10/2026', 3, 1240, 'Riverside Arena'), ('NPS', 'RSH', '17/10/2026', 8, 980, 'Northport Gym'),
             ('RSH', 'LKW', '24/10/2026', 15, 1310, 'Riverside Arena'), ('HCF', 'RSH', '31/10/2026', 21, 870, 'Hillcrest Hall')]
    for h, a, date, seed, spec, hall in games:
        lines, t = build(h, a, date, seed, spec, hall)
        d, m, y = date.split('/')
        fn = os.path.join(out_dir, f"{y}-{m}-{d} {h} vs {a}.dvw")
        with open(fn, 'w', encoding='latin1', newline='') as f:
            f.write('\r\n'.join(lines) + '\r\n')
        print(fn, len(lines), 'lines', round(t / 60), 'min')
