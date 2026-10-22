// Overlay drawing shared by every PNG in the M0 check.
// Layout is authored at 720p and scaled by H / 720, so 1080p redraws sharp.
// Colors follow SyncScout's scoreboard (scouting-screen.css).
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';

const C = { surface: '#F8FAFC', text: '#0F172A', sub: '#475569', primary: '#4B61D1' };
const FONT = 'Segoe UI';

GlobalFonts.registerFromPath('C:/Windows/Fonts/segoeui.ttf', FONT);
GlobalFonts.registerFromPath('C:/Windows/Fonts/segoeuib.ttf', FONT);

export function renderPNG(W, H, draw) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  draw(ctx, W, H, H / 720);
  return canvas.encode('png');
}

// sb: { left, right, setsL, setsR, ptsL, ptsR, winner: 'L'|'R'|null }
export function drawScoreboard(ctx, W, H, s, sb) {
  const padX = 22 * s, gap = 18 * s, h = 64 * s, top = 14 * s;
  const codeFont = `bold ${24 * s}px "${FONT}"`, labelFont = `bold ${12 * s}px "${FONT}"`;
  const setsFont = `bold ${17 * s}px "${FONT}"`, ptsFont = `bold ${27 * s}px "${FONT}"`;

  ctx.font = codeFont;
  const wL = ctx.measureText(sb.left).width, wR = ctx.measureText(sb.right).width;
  ctx.font = ptsFont;
  const ptsText = [pad(sb.ptsL), '-', pad(sb.ptsR)];
  const ptsW = ptsText.map(t => ctx.measureText(t).width);
  ctx.font = labelFont;
  const labelW = Math.max(ctx.measureText('SETS').width, ctx.measureText('PTS').width);
  const valueW = ptsW[0] + ptsW[1] + ptsW[2] + 6 * s;
  const midW = labelW + 8 * s + valueW;
  const w = padX * 2 + wL + wR + gap * 2 + midW;
  const x = (W - w) / 2;

  ctx.fillStyle = C.surface;
  roundRect(ctx, x, top, w, h, h / 2); ctx.fill();

  ctx.textBaseline = 'middle';
  ctx.fillStyle = C.text; ctx.font = codeFont;
  ctx.fillText(sb.left, x + padX, top + h / 2);
  ctx.fillText(sb.right, x + w - padX - wR, top + h / 2);

  const mx = x + padX + wL + gap, vx = mx + labelW + 8 * s;
  const row1 = top + h * 0.30, row2 = top + h * 0.68;
  ctx.font = labelFont; ctx.fillStyle = C.sub; ctx.textAlign = 'right';
  ctx.fillText('SETS', mx + labelW, row1);
  ctx.fillText('PTS', mx + labelW, row2);
  ctx.textAlign = 'left';

  ctx.font = setsFont; ctx.fillStyle = C.text;
  const setsText = `${sb.setsL}-${sb.setsR}`;
  ctx.fillText(setsText, vx + (valueW - ctx.measureText(setsText).width) / 2, row1);

  ctx.font = ptsFont;
  let px = vx;
  ctx.fillStyle = sb.winner === 'L' ? C.primary : C.text; ctx.fillText(ptsText[0], px, row2); px += ptsW[0] + 3 * s;
  ctx.fillStyle = C.sub; ctx.fillText(ptsText[1], px, row2); px += ptsW[1] + 3 * s;
  ctx.fillStyle = sb.winner === 'R' ? C.primary : C.text; ctx.fillText(ptsText[2], px, row2);
}

// cap: { number, name, line }
export function drawPlayerCaption(ctx, W, H, s, cap) {
  const h = 68 * s, margin = 22 * s, x = margin, y = H - margin - h, r = 10 * s;
  const nameFont = `bold ${24 * s}px "${FONT}"`, lineFont = `${17 * s}px "${FONT}"`, numFont = `bold ${32 * s}px "${FONT}"`;
  ctx.font = nameFont; const nW = ctx.measureText(cap.name).width;
  ctx.font = lineFont; const lW = ctx.measureText(cap.line).width;
  const boxW = h, textW = Math.max(nW, lW) + 32 * s, w = boxW + textW;

  ctx.fillStyle = C.surface; roundRect(ctx, x, y, w, h, r); ctx.fill();
  ctx.save(); roundRect(ctx, x, y, w, h, r); ctx.clip();
  ctx.fillStyle = C.primary; ctx.fillRect(x, y, boxW, h);
  ctx.restore();

  ctx.textBaseline = 'middle';
  ctx.font = numFont; ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'center';
  ctx.fillText(String(cap.number), x + boxW / 2, y + h / 2);
  ctx.textAlign = 'left';
  ctx.font = nameFont; ctx.fillStyle = C.text; ctx.fillText(cap.name, x + boxW + 16 * s, y + h * 0.36);
  ctx.font = lineFont; ctx.fillStyle = C.sub; ctx.fillText(cap.line, x + boxW + 16 * s, y + h * 0.72);
}

// Annotations use normalized 0..1 coordinates, like the app will store them.
export function drawText(ctx, W, H, s, a) {
  ctx.font = `bold ${a.size * s}px "${FONT}"`;
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 6 * s; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(a.text, a.x * W, a.y * H);
  ctx.fillStyle = a.color; ctx.fillText(a.text, a.x * W, a.y * H);
}

export function drawArrow(ctx, W, H, s, a) {
  const x1 = a.x1 * W, y1 = a.y1 * H, x2 = a.x2 * W, y2 = a.y2 * H;
  const lw = a.width * s, head = lw * 3.2, ang = Math.atan2(y2 - y1, x2 - x1);
  const bx = x2 - Math.cos(ang) * head * 0.8, by = y2 - Math.sin(ang) * head * 0.8;
  ctx.strokeStyle = a.color; ctx.fillStyle = a.color; ctx.lineWidth = lw; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(bx, by); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(ang - 0.45), y2 - head * Math.sin(ang - 0.45));
  ctx.lineTo(x2 - head * Math.cos(ang + 0.45), y2 - head * Math.sin(ang + 0.45));
  ctx.closePath(); ctx.fill();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function pad(n) { return String(n).padStart(2, '0'); }
