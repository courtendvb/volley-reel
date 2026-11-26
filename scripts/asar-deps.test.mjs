import { describe, expect, it } from 'vitest'
import { unresolvedDeps } from './asar-deps.mjs'

const pkgs = entries => new Map(entries)

describe('unresolvedDeps', () => {
  it('finds dependencies hoisted to the top and nested in a package', () => {
    expect(unresolvedDeps(pkgs([
      ['', { dependencies: { 'electron-updater': '6', '@s/x': '1' } }],
      ['node_modules/electron-updater', { name: 'electron-updater', dependencies: { 'fs-extra': '10', semver: '7' } }],
      ['node_modules/electron-updater/node_modules/semver', { name: 'semver' }],
      ['node_modules/fs-extra', { name: 'fs-extra', dependencies: { 'graceful-fs': '4' } }],
      ['node_modules/graceful-fs', { name: 'graceful-fs' }],
      ['node_modules/@s/x', { name: '@s/x', dependencies: { 'graceful-fs': '4' } }],
    ]))).toEqual([])
  })

  it('names what 1.0.7 lacked: the dependencies of a dependency', () => {
    expect(unresolvedDeps(pkgs([
      ['', { dependencies: { 'electron-updater': '6', fflate: '0.8' } }],
      ['node_modules/electron-updater', { name: 'electron-updater', dependencies: { 'fs-extra': '10', semver: '7' } }],
      ['node_modules/fflate', { name: 'fflate' }],
      ['node_modules/semver', { name: 'semver' }],
    ]))).toEqual(['electron-updater -> fs-extra'])
  })

  it('does not look into a sibling package for a nested one', () => {
    expect(unresolvedDeps(pkgs([
      ['', { dependencies: { a: '1', b: '1' } }],
      ['node_modules/a', { name: 'a' }],
      ['node_modules/a/node_modules/c', { name: 'c' }],
      ['node_modules/b', { name: 'b', dependencies: { c: '1' } }],
    ]))).toEqual(['b -> c'])
  })

  it('lets optional dependencies be missing', () => {
    expect(unresolvedDeps(pkgs([
      ['', { dependencies: { a: '1' } }],
      ['node_modules/a', { name: 'a', dependencies: { o: '1' }, optionalDependencies: { o: '1' } }],
    ]))).toEqual([])
  })
})
