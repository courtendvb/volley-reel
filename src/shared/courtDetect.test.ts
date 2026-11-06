import { describe, expect, it } from 'vitest'
import { homography, project, type CourtFit } from './court'
import { DETECT_H, DETECT_W, detectCourt } from './courtDetect'

const w = DETECT_W, h = DETECT_H
const corners: CourtFit['corners'] = [{ x: 0.25, y: 0.48 }, { x: 0.75, y: 0.48 }, { x: 0.08, y: 0.93 }, { x: 0.92, y: 0.93 }]

// A flat floor with the court's lines painted on it.
function picture(lines = true, court = corners, net = false): Uint8Array {
  const data = new Uint8Array(w * h * 3).fill(120)
  if (!lines) return data
  const H = homography(court.map(c => ({ x: c.x * w, y: c.y * h })) as CourtFit['corners'])
  const paint = (a: (s: number) => [number, number]) => {
    for (let i = 0; i <= 2000; i++) {
      const [u, v] = a(i / 2000), p = project(H, u, v), x = Math.round(p.x), y = Math.round(p.y)
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) data.fill(250, ((y + dy) * w + x + dx) * 3, ((y + dy) * w + x + dx) * 3 + 3)
    }
  }
  for (const v of [0, 1 / 3, 0.5, 2 / 3, 1]) paint(s => [s, v])
  for (const u of [0, 1]) paint(s => [u, s])
  if (net) data.fill(250, Math.round(h * 0.3) * w * 3, (Math.round(h * 0.3) + 3) * w * 3) // a bright band across the picture, above the court
  return data
}

describe('detectCourt', () => {
  it('finds the corners of a painted court', () => {
    const found = detectCourt([picture(), picture(), picture()])!
    found.corners.forEach((c, i) => {
      expect(Math.abs(c.x - corners[i].x) * w).toBeLessThan(5)
      expect(Math.abs(c.y - corners[i].y) * h).toBeLessThan(5)
    })
  })
  it('is not taken in by a straight line above the far end', () => {
    const c = detectCourt([picture(true, corners, true)])!.corners
    expect(Math.abs(c[0].y - corners[0].y) * h).toBeLessThan(5)
  })
  it('wants the court in the middle of the picture', () => {
    expect(detectCourt([picture(true, corners.map(c => ({ ...c, x: c.x - 0.08 })) as CourtFit['corners'])])).toBeNull()
  })
  it('says nothing when there is no court', () => {
    expect(detectCourt([picture(false)])).toBeNull()
    expect(detectCourt([])).toBeNull()
  })
})
