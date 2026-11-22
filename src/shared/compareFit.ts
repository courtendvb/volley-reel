// Matching the scale of two comparison videos by their courts: each match's fitted court grid (CourtFit)
// says where the court's four corners are in its picture, so one picture's zoom and position can be found
// that lays its court on the other's. Only a zoom and a move can be had (the view's own freedom), so a
// difference of camera angle (the court seen as a different trapezoid) is left as a remainder, reported.
import { clampView, type PaneView } from './videoCompare'

export interface Pt { x: number; y: number }

// Where a picture sits in a box that shows it whole (object-fit: contain), in box lengths.
// videoAspect, boxAspect: width / height.
export function pictureRect(videoAspect: number, boxAspect: number): { x: number; y: number; w: number; h: number } {
  const w = videoAspect >= boxAspect ? 1 : videoAspect / boxAspect
  const h = videoAspect >= boxAspect ? boxAspect / videoAspect : 1
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h }
}

// A point of the picture (0..1 over it) as the box shows it unzoomed: from the box centre, in box heights
// (so a zoom is the same in both directions).
export function inBox(u: Pt, videoAspect: number, boxAspect: number): Pt {
  const r = pictureRect(videoAspect, boxAspect)
  return { x: (r.x + u.x * r.w - 0.5) * boxAspect, y: r.y + u.y * r.h - 0.5 }
}

// Where a view puts such a point on screen. A view's own x is in box widths, so it is made box heights here.
export const onScreen = (p: Pt, v: PaneView, boxAspect: number): Pt => ({ x: v.x * boxAspect + v.zoom * p.x, y: v.y + v.zoom * p.y })

// The zoom and move that bring points p nearest (least squares) to points q.
export function fitSimilarity(p: Pt[], q: Pt[]): { scale: number; tx: number; ty: number } {
  const n = p.length
  const pm = { x: p.reduce((s, a) => s + a.x, 0) / n, y: p.reduce((s, a) => s + a.y, 0) / n }
  const qm = { x: q.reduce((s, a) => s + a.x, 0) / n, y: q.reduce((s, a) => s + a.y, 0) / n }
  let num = 0, den = 0
  for (let i = 0; i < n; i++) {
    num += (p[i].x - pm.x) * (q[i].x - qm.x) + (p[i].y - pm.y) * (q[i].y - qm.y)
    den += (p[i].x - pm.x) ** 2 + (p[i].y - pm.y) ** 2
  }
  const scale = den > 0 ? num / den : 1
  return { scale, tx: qm.x - scale * pm.x, ty: qm.y - scale * pm.y }
}

export interface FitSide { corners: Pt[]; aspect: number; view: PaneView } // the court's corners over the picture, the picture's aspect, its view now
export interface CourtAlignment { left: PaneView; right: PaneView; offBy: number } // the new views; the corners' RMS gap left, in box heights

// How far the left picture may be zoomed in to give both room to move (a picture can't leave its box,
// so a view at zoom 1 can't be moved at all), smallest first.
const LEFT_ZOOMS = [1, 1.25, 1.5, 2, 3]

// Lays the right court on the left's. First the right alone is zoomed and moved; where that can't reach
// (the right court is the bigger, or the move is more than a picture has room for) the left is zoomed in
// a little too, about its court, and the right fitted to it again. The least zoom that fits best wins.
export function alignCourts(left: FitSide, right: FitSide, boxAspect: number): CourtAlignment {
  const base = (s: FitSide) => s.corners.map(c => inBox(c, s.aspect, boxAspect))
  const pl = base(left), pr = base(right)
  const centre = { x: pl.reduce((s, p) => s + p.x, 0) / pl.length, y: pl.reduce((s, p) => s + p.y, 0) / pl.length }
  const gap = (a: Pt[], b: Pt[]) => Math.sqrt(a.reduce((s, p, i) => s + (p.x - b[i].x) ** 2 + (p.y - b[i].y) ** 2, 0) / a.length)
  let best: CourtAlignment | null = null
  for (const k of LEFT_ZOOMS) {
    const lv = k === 1 ? left.view : clampView({ zoom: k, x: -k * centre.x / boxAspect, y: -k * centre.y }) // the court kept in the middle
    const ql = pl.map(p => onScreen(p, lv, boxAspect))
    const f = fitSimilarity(pr, ql)
    const rv = clampView({ zoom: f.scale, x: f.tx / boxAspect, y: f.ty })
    const offBy = gap(pr.map(p => onScreen(p, rv, boxAspect)), ql)
    if (!best || offBy < best.offBy - 0.002) best = { left: lv, right: rv, offBy }
  }
  return best!
}
