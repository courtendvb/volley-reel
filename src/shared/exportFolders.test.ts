import { describe, expect, it } from 'vitest'
import { lastFolder, rememberFolder } from './exportFolders'

describe('export folders', () => {
  const there = (dir: string) => dir !== 'D:\\gone'
  it('remembers the last folder per project and kind, the project folder compared without case', () => {
    let all = rememberFolder(undefined, 'C:\\Projects\\HTH', 'video', 'D:\\videos')
    all = rememberFolder(all, 'c:\\projects\\hth\\', 'docs', 'D:\\slides')
    expect(lastFolder(all, 'C:\\PROJECTS\\HTH', 'video', there)).toBe('D:\\videos')
    expect(lastFolder(all, 'C:\\Projects\\HTH', 'docs', there)).toBe('D:\\slides')
    expect(lastFolder(all, 'C:\\Projects\\Other', 'video', there)).toBeNull()
  })
  it('forgets a folder that is no longer there', () => {
    expect(lastFolder(rememberFolder(undefined, 'P', 'video', 'D:\\gone'), 'P', 'video', there)).toBeNull()
  })
  it('keeps the latest projects only', () => {
    let all = {}
    for (let i = 0; i < 5; i++) all = rememberFolder(all, `P${i}`, 'video', `D:\\${i}`, 3)
    expect(Object.keys(all)).toEqual(['p2', 'p3', 'p4'])
    all = rememberFolder(all, 'P2', 'docs', 'D:\\d', 3) // used again: the latest
    expect(Object.keys(all)).toEqual(['p3', 'p4', 'p2'])
  })
})
