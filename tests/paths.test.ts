import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonical, isUnder, namesDirectory, nearestDirectory, physicalDirectory, resolveFrom } from '../src/host/paths.ts'
import { tempDir } from './helpers.ts'

describe('resolveFrom', () => {
  it('resolves relative paths against the base and keeps absolute ones', () => {
    expect(resolveFrom('/a/b', 'c/../d')).toBe('/a/b/d')
    expect(resolveFrom('/a/b', '/x/y/')).toBe('/x/y')
  })

  it('expands the home directory', () => {
    expect(resolveFrom('/a', '~')).toBe(homedir())
    expect(resolveFrom('/a', '~/notes')).toBe(join(homedir(), 'notes'))
  })
})

describe('canonical', () => {
  it('resolves symlinks in the existing prefix and keeps a missing suffix', () => {
    const root = tempDir()
    mkdirSync(join(root, 'real'))
    symlinkSync(join(root, 'real'), join(root, 'alias'))
    expect(canonical(join(root, 'alias'))).toBe(join(root, 'real'))
    expect(canonical(join(root, 'alias', 'new', 'file.txt'))).toBe(join(root, 'real', 'new', 'file.txt'))
  })

  it('spells the temp directory the way the host sandbox compares it', () => {
    expect(canonical(tmpdir())).toBe(realpathSync.native(tmpdir()))
  })
})

describe('isUnder', () => {
  it('accepts the root itself and its descendants only', () => {
    expect(isUnder('/a/b', '/a/b')).toBe(true)
    expect(isUnder('/a/b/c', '/a/b')).toBe(true)
    expect(isUnder('/a/bc', '/a/b')).toBe(false)
    expect(isUnder('/a', '/a/b')).toBe(false)
  })
})

describe('physicalDirectory and nearestDirectory', () => {
  it('accepts only existing, non-symlinked directories', () => {
    const root = tempDir()
    mkdirSync(join(root, 'dir'))
    writeFileSync(join(root, 'file'), 'x')
    symlinkSync(join(root, 'dir'), join(root, 'link'))
    expect(physicalDirectory(join(root, 'dir'))).toBe(join(root, 'dir'))
    expect(physicalDirectory(join(root, 'file'))).toBeUndefined()
    expect(physicalDirectory(join(root, 'link'))).toBeUndefined()
    expect(physicalDirectory(join(root, 'missing'))).toBeUndefined()
  })

  it('climbs to the deepest existing directory', () => {
    const root = tempDir()
    expect(nearestDirectory(join(root, 'a', 'b', 'c'))).toBe(root)
  })
})

describe('namesDirectory', () => {
  it('treats a trailing separator as asking for a directory', () => {
    expect(namesDirectory('docs/')).toBe(true)
    expect(namesDirectory('docs')).toBe(false)
  })
})
