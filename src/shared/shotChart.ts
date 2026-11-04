// A shot chart: the serves and attacks of a search as arrows on a picture of the court, all played
// from the near side up, whichever side and match they came from. Ordinary objects on a slide, so
// each can be moved or removed. Pure, so it is unit-tested without the app.
import type { Annotation } from './annotation'
import { courtCamera, homography, project, strikeHeight, type CourtFit, type Pt } from './court'
import type { PlayRef } from './filter'
import { t } from './i18n'

const CROWDED = 40
const KILL = '#EF4444', FAILED = '#3B82F6', OTHER = '#FACC15'
const color = (effect: string) => (effect === '#' ? KILL : effect === '=' || effect === '/' ? FAILED : OTHER)

export interface ShotChart { annotations: Annotation[]; shots: number; left: number } // left: serves and attacks without clicks

// fit, w and h: the court on the picture the chart is laid on, in that picture's pixels.
export function shotChart(refs: PlayRef[], fit: CourtFit, w: number, h: number, title: string, newId: () => string = () => crypto.randomUUID()): ShotChart {
  const corners = fit.corners.map(p => ({ x: p.x * w, y: p.y * h })) as [Pt, Pt, Pt, Pt]
  const camera = courtCamera(corners, w, h), floor = homography(corners)
  const onPicture = (u: number, v: number, z: number): Pt => (camera ? camera(u, v, z) : project(floor, u, v))
  const shots = refs.filter(r => r.play.skill === 'S' || r.play.skill === 'A')
  const drawn = shots.filter(r => r.play.startClick && r.play.endClick)
  const crowded = drawn.length > CROWDED // thinner, so the spread still reads
  const arrows = drawn.map((r): Annotation => {
    const a = r.play.startClick!, b = r.play.endClick!
    // Seen from the player's team, which is put on the near side.
    const from = onPicture(a.u, 1 - a.v, strikeHeight(r.play.code)), to = onPicture(b.u, 1 - b.v, 0)
    return { id: newId(), kind: 'arrow', color: color(r.play.effect), x1: from.x / w, y1: from.y / h, x2: to.x / w, y2: to.y / h, ...(crowded ? { width: 2, opacity: 0.8 } : { width: 3 }) }
  })
  const kills = drawn.filter(r => r.play.effect === '#').length, failed = drawn.filter(r => color(r.play.effect) === FAILED).length
  const text = (y: number, s: string, size: number, bold: boolean): Annotation => ({ id: newId(), kind: 'text', color: '#FFFFFF', x: 0.03, y, text: s, size, bold, outline: true })
  const legend = t('{0} 本　赤: 決定 {1}　青: ミス・被ブロック {2}　黄: その他 {3}', drawn.length, kills, failed, drawn.length - kills - failed)
  return { annotations: [...arrows, text(0.04, title, 32, true), text(0.11, legend, 20, false)], shots: drawn.length, left: shots.length - drawn.length }
}
