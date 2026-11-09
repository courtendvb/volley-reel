import { describe, expect, it } from 'vitest'
import { pickerPlace } from './CheckPicker'

const button = (top: number) => ({ left: 10, top, bottom: top + 30, width: 200 })

describe('check picker list', () => {
  it('opens below the button, at most half the window high', () => {
    const p = pickerPlace(button(100), 900)
    expect(p).toMatchObject({ top: 132, left: 10, width: 260, maxHeight: 450 })
    expect(p.bottom).toBeUndefined()
  })

  it('opens above the button when the room below is short', () => {
    const p = pickerPlace(button(800), 900)
    expect(p).toMatchObject({ bottom: 102, maxHeight: 450 })
    expect(p.top).toBeUndefined()
  })

  it('stays inside the window: its height held to the room it has', () => {
    const p = pickerPlace(button(500), 900)
    expect(p.top).toBe(532)
    expect(p.maxHeight).toBe(360) // 900 − 530 − 2 − 8
  })

  it('keeps a usable height in a very small window', () => {
    expect(pickerPlace(button(60), 200).maxHeight).toBe(120)
  })
})
