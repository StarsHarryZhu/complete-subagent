import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
const manifest = JSON.parse(read('package.json')) as Record<string, any>

describe('package identity', () => {
  it('is complete-subagent 0.1.0 for DeepSeek Harness 0.2.1-rc.5 up to 0.3', () => {
    expect(manifest.name).toBe('@starsharryzhu/complete-subagent')
    expect(manifest.version).toBe('0.1.0')
    expect(manifest.engines.dsh).toBe('>=0.2.1-rc.5 <0.3.0-0')
    expect(manifest.peerDependencies['@deepseek-ai/dsh-tools']).toBe(manifest.engines.dsh)
  })

  it('has a web browser half for its settings page and no runtime dependency', () => {
    expect(manifest.dsh.client.platform).toBe('web')
    expect(manifest.exports['./client'].default).toBe('./lib/client.js')
    expect(manifest.dependencies).toEqual({})
  })

  it('shows a title on the Plugins page in both languages', () => {
    expect(JSON.parse(read('locale/en.json')).meta.title).toBe('Complete Subagent')
    expect(JSON.parse(read('locale/zh.json')).meta.title).toBe('完全子代理')
  })

  it('inserts one top-level row named after the package', () => {
    expect(read('cordis.patch.yml')).toMatch(/- insert:\n\s+- id: complete-subagent\n\s+name: '@starsharryzhu\/complete-subagent'\n/u)
  })

  it('ships the built halves', () => {
    expect(read('lib/index.js')).toContain('export const name = PLUGIN_ID')
    expect(read('lib/shared/settings.js')).toContain("export const PLUGIN_ID = 'complete-subagent'")
    expect(read('lib/client.js')).toContain('id: "@starsharryzhu/complete-subagent"')
  })
})
