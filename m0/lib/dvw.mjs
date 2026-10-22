// Minimal DVW parser for the M0 export check.
// Ported from HTH_videoviewer/dvw-parser.js, with the v2 design changes:
// players are identified by DataVolley player ID (not side + jersey),
// and every play carries a fingerprint so clips can re-link after edits.

export function parseDVW(text) {
  const teams = [], players = {}, plays = [], rallies = [];
  let section = '';
  let score = { h: 0, a: 0 }, sets = { h: 0, a: 0 };
  let homeRot = null, awayRot = null, rally = null;

  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (l.startsWith('[')) { section = l; continue; }
    if (!l) continue;
    const c = l.split(';');

    if (section === '[3TEAMS]') {
      if (teams.length < 2) teams.push({ code: c[0], name: (c[1] || '').trim() });
      continue;
    }
    if (section === '[3PLAYERS-H]' || section === '[3PLAYERS-V]') {
      const side = section.includes('-H') ? '*' : 'a';
      const jersey = parseInt(c[1]);
      if (isNaN(jersey)) continue;
      const lastName = (c[9] || '').trim(), firstName = (c[10] || '').trim();
      players[`${side}${jersey}`] = { key: playerKey(c[8], lastName, firstName, jersey), side, jersey, lastName, firstName };
      continue;
    }
    if (section !== '[3SCOUT]') continue;

    const code = c[0];
    if (!code) continue;
    const time = parseFloat(c[12]);

    if (code.startsWith('**') && /set/i.test(code)) {
      if (score.h > score.a) sets.h++; else if (score.a > score.h) sets.a++;
      score = { h: 0, a: 0 };
      rally = null;
      continue;
    }
    if (/^[*a]p\d/i.test(code)) {
      const m = code.match(/(\d{1,2}):(\d{1,2})/);
      if (!m) continue;
      const nh = +m[1], na = +m[2];
      const wonBy = nh > score.h ? '*' : na > score.a ? 'a' : code[0].toLowerCase();
      if (rally) { rally.pointTime = isNaN(time) ? null : time; rally.wonBy = wonBy; }
      score = { h: nh, a: na };
      rally = null;
      continue;
    }

    const skill = code.charAt(3);
    if (!'SRABDE'.includes(skill)) continue;
    const jersey = parseInt(code.substring(1, 3));
    // Fixed skip rule: no jersey (team codes like "a$$") or no video time.
    if (isNaN(jersey) || isNaN(time)) continue;

    let rH = parseInt(c[9]); if (!isNaN(rH)) homeRot = rH; else rH = homeRot;
    let rA = parseInt(c[10]); if (!isNaN(rA)) awayRot = rA; else rA = awayRot;

    if (skill === 'S') {
      rally = { id: rallies.length, serveTime: time, lastActionTime: time, pointTime: null, wonBy: null };
      rallies.push(rally);
    }
    if (rally) rally.lastActionTime = Math.max(rally.lastActionTime, time);

    const side = code.charAt(0);
    const p = players[`${side}${jersey}`];
    const setNum = sets.h + sets.a + 1;
    const scoreStr = `${pad(score.h)}-${pad(score.a)}`;
    plays.push({
      id: plays.length,
      fingerprint: `${setNum}|${scoreStr}|${code}|${time}`,
      time, side, jersey,
      playerKey: p ? p.key : `${side}${jersey}`,
      skill, effect: code.charAt(5),
      setNum,
      setsBefore: { home: sets.h, away: sets.a },
      score: scoreStr,
      homeRot: rH, awayRot: rA,
      rallyId: rally ? rally.id : null,
    });
  }

  return { teams, players, plays, rallies };
}

// Same person across matches: DataVolley player ID with the scrimmage "-a" suffix removed.
export function playerKey(rawId, lastName, firstName, jersey) {
  const id = (rawId || '').trim();
  return id ? id.replace(/-a$/i, '') : `${lastName}|${firstName}|${jersey}`;
}

// "YANAKITA Y." — the initial is added only when the surname repeats on that side.
export function displayName(players, side, jersey) {
  const p = players[`${side}${jersey}`];
  if (!p) return `#${jersey}`;
  const clash = Object.values(players).some(o => o !== p && o.side === side && o.lastName === p.lastName);
  return clash && p.firstName ? `${p.lastName} ${p.firstName.charAt(0)}.` : p.lastName;
}

function pad(n) { return String(n).padStart(2, '0'); }
