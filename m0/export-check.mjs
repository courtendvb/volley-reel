// M0: export check (docs/design.md §9).
//
//   node export-check.mjs --match <video.mp4> <scout.dvw> [--match <video> <dvw> ...]
//   node export-check.mjs --synthetic <scout.dvw> [<scout.dvw> ...]   (generated test video)
//
// Options: --clips 5  --res 720  --our HTH,HTA  --compare (also time a single-pass filter_complex export)
//
// Steps: probe → strip audio → parse DVW → pick clips → draw overlay PNGs →
// per-clip encode + concat demuxer → measure speed / size / seams / sharpness.
// Everything lands in m0/out/<timestamp>/ with report.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDVW, displayName } from './lib/dvw.mjs';
import { renderPNG, drawScoreboard, drawPlayerCaption, drawText, drawArrow } from './lib/overlay.mjs';
import { ffmpeg, probe, run, FFPROBE } from './lib/ff.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const labels = JSON.parse(fs.readFileSync(path.join(here, 'labels.json'), 'utf8'));
const opt = parseArgs(process.argv.slice(2));
const H = opt.res, W = Math.round(H * 16 / 9), FPS = 30;
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(here, 'out', stamp), workDir = path.join(here, 'work');
fs.mkdirSync(outDir, { recursive: true }); fs.mkdirSync(workDir, { recursive: true });
const report = { settings: { res: `${W}x${H}`, fps: FPS, clips: opt.clips, synthetic: opt.synthetic }, matches: [], clips: [], timings: {} };
const log = (...a) => console.log(...a);

// ---- 1. matches: probe, strip audio, parse -------------------------------------------------
const matches = [];
for (const [i, m] of opt.matches.entries()) {
  const dvw = parseDVW(fs.readFileSync(m.dvw, 'latin1'));
  const id = `m${i + 1}`;
  let video = m.video;
  if (opt.synthetic) video = await makeSyntheticVideo(id, i, dvw);

  const info = await probe(video);
  const playable = info.codec === 'h264' && info.pixFmt === 'yuv420p';
  const prepared = path.join(workDir, `${id}-prepared.mp4`);
  const t0 = Date.now();
  if (playable) {
    await ffmpeg(['-i', video, '-map', '0:v:0', '-an', '-c:v', 'copy', '-movflags', '+faststart', prepared]);
  } else {
    // 4:2:2 / 10-bit / non-H.264 sources: Chromium can't decode them, so re-encode to 8-bit 4:2:0.
    await ffmpeg(['-i', video, '-map', '0:v:0', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', prepared]);
  }
  const prepSec = (Date.now() - t0) / 1000;
  const after = await probe(prepared);
  const teamsLR = orientTeams(dvw.teams, opt.our);
  matches.push({ id, video: prepared, dvw, info: after, teamsLR, label: path.basename(m.dvw) });
  report.matches.push({ id, dvw: path.basename(m.dvw), source: path.basename(video), before: info, after,
    action: playable ? 'remux (-an -c:v copy)' : 'reencode to yuv420p', prepareSec: prepSec,
    teams: dvw.teams.map(t => t.code).join(' vs '), plays: dvw.plays.length, rallies: dvw.rallies.length });
  log(`${id}: ${path.basename(m.dvw)}  ${info.codec}/${info.pixFmt} ${info.width}x${info.height}@${info.fps.toFixed(2)}  audio=[${info.audio}]  → ${playable ? 'remux' : 'reencode'} ${prepSec.toFixed(1)}s`);
}

// ---- 2. pick clips across matches ------------------------------------------------------------
const clips = pickClips(matches, opt.clips);
if (clips.length < 2) throw new Error('Not enough usable plays to build a reel');

// ---- 3. overlay PNGs -------------------------------------------------------------------------
for (const [i, c] of clips.entries()) {
  const m = c.match, p = c.play, r = m.dvw.rallies[p.rallyId];
  const L = m.teamsLR.leftSide;
  const sb = {
    left: m.teamsLR.left.code, right: m.teamsLR.right.code,
    setsL: L === '*' ? p.setsBefore.home : p.setsBefore.away,
    setsR: L === '*' ? p.setsBefore.away : p.setsBefore.home,
    ptsL: +p.score.split('-')[L === '*' ? 0 : 1], ptsR: +p.score.split('-')[L === '*' ? 1 : 0],
    winner: r?.wonBy ? (r.wonBy === L ? 'L' : 'R') : null,
  };
  const cap = {
    number: p.jersey,
    name: displayName(m.dvw.players, p.side, p.jersey),
    line: `${labels.skills[p.skill]} · ${labels.effects[p.skill]?.[p.effect] ?? p.effect}`,
  };
  c.caption = cap; c.scoreboard = sb;
  c.basePng = path.join(outDir, `clip${i + 1}-base.png`);
  fs.writeFileSync(c.basePng, await renderPNG(W, H, (ctx, w, h, s) => {
    drawScoreboard(ctx, w, h, s, sb);
    drawPlayerCaption(ctx, w, h, s, cap);
    drawText(ctx, w, h, s, { x: 0.62, y: 0.80, size: 34, color: '#FFFFFF', text: 'Watch the platform angle' });
    drawArrow(ctx, w, h, s, { x1: 0.30, y1: 0.30, x2: 0.45, y2: 0.52, width: 7, color: '#FACC15' });
  }));
  // Clip 2 gets a second, timed annotation to test `enable='between(t,a,b)'`.
  if (i === 1) {
    c.timed = { from: Math.min(1.5, c.dur / 3), to: Math.min(4.0, c.dur * 0.8) };
    c.timedPng = path.join(outDir, `clip${i + 1}-timed.png`);
    fs.writeFileSync(c.timedPng, await renderPNG(W, H, (ctx, w, h, s) => {
      drawArrow(ctx, w, h, s, { x1: 0.80, y1: 0.25, x2: 0.62, y2: 0.45, width: 9, color: '#EF4444' });
      drawText(ctx, w, h, s, { x: 0.66, y: 0.16, size: 40, color: '#EF4444', text: 'Timed (enable)' });
    }));
  }
}

// ---- 4. export: per-clip encode + concat demuxer ---------------------------------------------
const ENC = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-g', String(FPS * 2), '-video_track_timescale', '15360', '-an'];
const totalDur = clips.reduce((s, c) => s + c.dur, 0);
log(`\n${clips.length} clips, ${totalDur.toFixed(1)}s of footage → per-clip encode + concat`);

let t0 = Date.now(), doneSec = 0;
const segFiles = [];
for (const [i, c] of clips.entries()) {
  const seg = path.join(workDir, `seg${i + 1}.mp4`);
  const inputs = ['-ss', c.in.toFixed(3), '-t', c.dur.toFixed(3), '-i', c.match.video, '-i', c.basePng];
  let fc = `[0:v]scale=${W}:${H}:flags=lanczos,fps=${FPS},format=yuv420p,setsar=1[v0];[v0][1:v]overlay=0:0[v1]`;
  if (c.timedPng) {
    inputs.push('-i', c.timedPng);
    fc += `;[v1][2:v]overlay=0:0:enable='between(t,${c.timed.from.toFixed(2)},${c.timed.to.toFixed(2)})'[v2]`;
  }
  const outLabel = c.timedPng ? '[v2]' : '[v1]';
  await ffmpeg([...inputs, '-filter_complex', fc, '-map', outLabel, ...ENC, seg], {
    onProgress: sec => process.stdout.write(`\r  progress ${Math.min(100, (doneSec + sec) / totalDur * 100).toFixed(0).padStart(3)}%`),
  });
  doneSec += c.dur; segFiles.push(seg);
}
const listFile = path.join(workDir, 'concat.txt');
fs.writeFileSync(listFile, segFiles.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n'));
const outMp4 = path.join(outDir, 'reel.mp4');
await ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', outMp4]);
const encSec = (Date.now() - t0) / 1000;
report.timings.perClip = { wallSec: encSec, speed: totalDur / encSec };
log(`\r  done: ${encSec.toFixed(1)}s wall → ${(totalDur / encSec).toFixed(1)}x realtime`);

// ---- 4b. optional: single-pass filter_complex for comparison -----------------------------------
if (opt.compare) {
  const inputs = [], parts = [];
  let n = 0;
  clips.forEach((c, i) => {
    const vi = n++; inputs.push('-ss', c.in.toFixed(3), '-t', c.dur.toFixed(3), '-i', c.match.video);
    const bi = n++; inputs.push('-i', c.basePng);
    let chain = `[${vi}:v]scale=${W}:${H}:flags=lanczos,fps=${FPS},format=yuv420p,setsar=1[a${i}];[a${i}][${bi}:v]overlay=0:0[b${i}]`;
    let last = `b${i}`;
    if (c.timedPng) {
      const ti = n++; inputs.push('-i', c.timedPng);
      chain += `;[b${i}][${ti}:v]overlay=0:0:enable='between(t,${c.timed.from.toFixed(2)},${c.timed.to.toFixed(2)})'[c${i}]`;
      last = `c${i}`;
    }
    parts.push({ chain, last });
  });
  const fc = parts.map(p => p.chain).join(';') + ';' + parts.map(p => `[${p.last}]`).join('') + `concat=n=${parts.length}:v=1:a=0[out]`;
  const single = path.join(outDir, 'reel-singlepass.mp4');
  t0 = Date.now();
  await ffmpeg([...inputs, '-filter_complex', fc, '-map', '[out]', ...ENC, '-movflags', '+faststart', single]);
  const s = (Date.now() - t0) / 1000;
  report.timings.singlePass = { wallSec: s, speed: totalDur / s, sizeBytes: fs.statSync(single).size };
  log(`  single-pass: ${s.toFixed(1)}s → ${(totalDur / s).toFixed(1)}x realtime`);
}

// ---- 5. measure ------------------------------------------------------------------------------
const outInfo = await probe(outMp4);
const expectedFrames = clips.reduce((s, c) => s + Math.round(c.dur * FPS), 0);
const { out: cnt } = await run(FFPROBE, ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', outMp4]);
const { err: det } = await ffmpeg(['-i', outMp4, '-vf', 'blackdetect=d=0.03:pix_th=0.10,freezedetect=n=0.001:d=0.25', '-an', '-f', 'null', '-']);
const blacks = [...det.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map(m => [+m[1], +m[2]]);
const freezes = [...det.matchAll(/freeze_start: ([\d.]+)/g)].map(m => +m[1]);

// Boundary frames: last frame of clip k beside first frame of clip k+1.
let frame = 0;
const seams = [];
for (let k = 0; k < clips.length - 1; k++) {
  frame += Math.round(clips[k].dur * FPS);
  const img = path.join(outDir, `seam${k + 1}.png`);
  await ffmpeg(['-i', outMp4, '-vf', `select='eq(n\\,${frame - 1})+eq(n\\,${frame})',scale=640:-1,tile=2x1`, '-frames:v', '1', '-fps_mode', 'vfr', img]);
  seams.push({ atSec: frame / FPS, image: path.basename(img) });
}
// Sharpness: a full-res frame from clip 1 and a 2x crop of the caption + scoreboard.
const mid = clips[0].dur / 2;
await ffmpeg(['-ss', mid.toFixed(2), '-i', outMp4, '-frames:v', '1', path.join(outDir, 'frame-full.png')]);
await ffmpeg(['-ss', mid.toFixed(2), '-i', outMp4, '-vf', `crop=${Math.round(W * 0.45)}:${Math.round(H * 0.16)}:0:${Math.round(H * 0.84)},scale=iw*2:ih*2:flags=neighbor`, '-frames:v', '1', path.join(outDir, 'zoom-caption.png')]);
await ffmpeg(['-ss', mid.toFixed(2), '-i', outMp4, '-vf', `crop=${Math.round(W * 0.4)}:${Math.round(H * 0.14)}:${Math.round(W * 0.3)}:0,scale=iw*2:ih*2:flags=neighbor`, '-frames:v', '1', path.join(outDir, 'zoom-scoreboard.png')]);
// Timed annotation: one frame inside the window, one outside.
const c2Start = clips[0].dur;
if (clips[1].timed) {
  await ffmpeg(['-ss', (c2Start + (clips[1].timed.from + clips[1].timed.to) / 2).toFixed(2), '-i', outMp4, '-vf', 'scale=640:-1', '-frames:v', '1', path.join(outDir, 'timed-on.png')]);
  await ffmpeg(['-ss', (c2Start + clips[1].timed.from / 3).toFixed(2), '-i', outMp4, '-vf', 'scale=640:-1', '-frames:v', '1', path.join(outDir, 'timed-off.png')]);
}

report.output = { file: 'reel.mp4', ...outInfo, frames: +cnt.trim(), expectedFrames, footageSec: totalDur, blacks, freezes, seams };
report.clips = clips.map((c, i) => ({ n: i + 1, match: c.match.id, playId: c.play.id, fingerprint: c.play.fingerprint, mode: c.mode,
  in: +c.in.toFixed(2), out: +(c.in + c.dur).toFixed(2), dur: +c.dur.toFixed(2), caption: `${c.caption.number} ${c.caption.name} — ${c.caption.line}`,
  score: `${c.scoreboard.left} ${c.scoreboard.setsL}-${c.scoreboard.setsR} / ${c.scoreboard.ptsL}-${c.scoreboard.ptsR} ${c.scoreboard.right}`, timed: c.timed || null }));
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(outDir, 'report.md'), renderReport(report));
log(`\nframes ${cnt.trim()} / expected ${expectedFrames}, black ${blacks.length}, freeze ${freezes.length}, size ${(outInfo.sizeBytes / 1e6).toFixed(1)}MB`);
log(`report: ${path.join(outDir, 'report.md')}`);

// =============================================================================================

function parseArgs(argv) {
  const o = { matches: [], clips: 5, res: 720, our: ['HTH', 'HTA'], compare: false, synthetic: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--match') o.matches.push({ video: argv[++i], dvw: argv[++i] });
    else if (a === '--synthetic') { o.synthetic = true; while (argv[i + 1] && !argv[i + 1].startsWith('--')) o.matches.push({ video: null, dvw: argv[++i] }); }
    else if (a === '--clips') o.clips = +argv[++i];
    else if (a === '--res') o.res = +argv[++i];
    else if (a === '--our') o.our = argv[++i].split(',');
    else if (a === '--compare') o.compare = true;
    else throw new Error(`Unknown option ${a}`);
  }
  if (!o.matches.length) throw new Error('Give --match <video> <dvw> or --synthetic <dvw>...');
  return o;
}

// Our team always on the left; scrimmages (both sides ours) keep home on the left.
function orientTeams(teams, our) {
  const [home, away] = teams;
  const awayOurs = our.includes(away.code) && !our.includes(home.code);
  return awayOurs ? { left: away, right: home, leftSide: 'a' } : { left: home, right: away, leftSide: '*' };
}

// Rally window ends at the last action, not the point line: in real files the
// point code is logged ~10s after the final contact.
function clipWindow(dvw, play, mode) {
  const r = dvw.rallies[play.rallyId];
  if (mode === 'rally') return { in: r.serveTime - 1.5, out: r.lastActionTime + 2.5 };
  return { in: play.time - 3, out: play.time + 4 };
}

function pickClips(ms, count) {
  const wanted = [['A', '#'], ['R', '#'], ['S', '#'], ['D', '+'], ['B', '#'], ['A', '/'], ['R', '-']];
  const out = [];
  const perMatch = ms.map((m, i) => Math.floor(count / ms.length) + (i < count % ms.length ? 1 : 0));
  ms.forEach((m, mi) => {
    const usedRallies = new Set();
    const ours = side => side === m.teamsLR.leftSide;
    const ok = p => p.rallyId != null && !usedRallies.has(p.rallyId);
    const picked = [];
    for (const [sk, ef] of wanted) {
      if (picked.length >= perMatch[mi]) break;
      const p = m.dvw.plays.find(p => ok(p) && ours(p.side) && p.skill === sk && p.effect === ef && fits(m, p));
      if (p) { picked.push(p); usedRallies.add(p.rallyId); }
    }
    for (const p of m.dvw.plays) {
      if (picked.length >= perMatch[mi]) break;
      if (ok(p) && fits(m, p)) { picked.push(p); usedRallies.add(p.rallyId); }
    }
    picked.sort((a, b) => a.time - b.time).forEach((p, k) => {
      const mode = k % 2 === 0 ? 'rally' : 'keyplay';
      const w = clipWindow(m.dvw, p, mode);
      out.push({ match: m, play: p, mode, in: Math.max(0, w.in), dur: w.out - Math.max(0, w.in) });
    });
  });
  return out;
}

function fits(m, p) {
  const w = clipWindow(m.dvw, p, 'rally');
  return w.in >= 0 && w.out <= m.info.duration - 0.5 && w.out - w.in < 40;
}

// Synthetic source for running before real footage arrives: 720p30 H.264 + PCM audio in MOV
// (mimics XAVC S's LPCM track), long enough to cover the first plays of the DVW.
// DVW times are shifted (like Match.offsetSec) so the first serve lands at 5s — some files,
// e.g. scrimmages, start their video clock near 2h.
async function makeSyntheticVideo(id, i, dvw) {
  const shift = 5 - dvw.rallies[0].serveTime;
  for (const p of dvw.plays) p.time += shift;
  for (const r of dvw.rallies) { r.serveTime += shift; r.lastActionTime += shift; if (r.pointTime != null) r.pointTime += shift; }
  const firstRallies = dvw.rallies.slice(0, 12);
  const len = Math.ceil(Math.max(...firstRallies.map(r => r.lastActionTime)) + 10);
  const file = path.join(workDir, `${id}-synthetic-${len}s.mov`);
  if (!fs.existsSync(file)) {
    log(`${id}: generating ${len}s synthetic source…`);
    await ffmpeg(['-f', 'lavfi', '-i', `testsrc=size=1280x720:rate=30,hue=h=${i * 120}`, '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
      '-t', String(len), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', file]);
  }
  return file;
}

function renderReport(r) {
  const o = r.output, pc = r.timings.perClip, sp = r.timings.singlePass;
  const pass = (b) => b ? '✅' : '❌';
  const lines = [
    `# M0 export check — ${stamp}`, '',
    `- Output: ${r.settings.res} @ ${r.settings.fps}fps, ${r.clips.length} clips from ${r.matches.length} match(es)${r.settings.synthetic ? ' — **synthetic source video**' : ''}`, '',
    '## Pass criteria', '',
    '| Criterion | Result | |', '|---|---|---|',
    `| ≥ 3x realtime | ${pc.speed.toFixed(1)}x (${o.footageSec.toFixed(1)}s footage in ${pc.wallSec.toFixed(1)}s) | ${pass(pc.speed >= 3)} |`,
    `| No black frames / freezes at seams | black ${o.blacks.length}, freeze ${o.freezes.length}; frames ${o.frames} / expected ${o.expectedFrames} | ${pass(!o.blacks.length && !o.freezes.length && Math.abs(o.frames - o.expectedFrames) <= r.clips.length)} |`,
    `| Overlays sharp | check \`zoom-caption.png\`, \`zoom-scoreboard.png\`, \`frame-full.png\` by eye | 👀 |`, '',
    `Output size: ${(o.sizeBytes / 1e6).toFixed(2)} MB (${(o.sizeBytes * 8 / o.duration / 1e6).toFixed(2)} Mbps), duration ${o.duration.toFixed(2)}s.`,
    sp ? `Single-pass filter_complex: ${sp.speed.toFixed(1)}x realtime, ${(sp.sizeBytes / 1e6).toFixed(2)} MB.` : '', '',
    '## Sources', '', '| Match | DVW | Before | After | Prepare |', '|---|---|---|---|---|',
    ...r.matches.map(m => `| ${m.id} ${m.teams} | ${m.dvw} | ${m.before.codec}/${m.before.pixFmt} ${m.before.width}x${m.before.height}@${m.before.fps.toFixed(2)} audio=[${m.before.audio}] | ${m.after.codec}/${m.after.pixFmt} audio=[${m.after.audio}] | ${m.action}, ${m.prepareSec.toFixed(1)}s |`), '',
    '## Clips', '', '| # | Match | Mode | IN–OUT | Caption | Scoreboard |', '|---|---|---|---|---|---|',
    ...r.clips.map(c => `| ${c.n} | ${c.match} | ${c.mode} | ${c.in}–${c.out} (${c.dur}s) | ${c.caption} | ${c.score} |`), '',
    '## Seams', '', ...o.seams.map(s => `- ${s.atSec.toFixed(2)}s → \`${s.image}\` (left: last frame of clip, right: first frame of next)`), '',
    r.clips[1]?.timed ? `Timed annotation on clip 2: ${r.clips[1].timed.from.toFixed(2)}–${r.clips[1].timed.to.toFixed(2)}s → \`timed-on.png\` / \`timed-off.png\`` : '',
  ];
  return lines.join('\n') + '\n';
}
