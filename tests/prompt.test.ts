import { describe, expect, it } from 'vitest'
import {
  childContext,
  CWD_DESCRIPTION,
  delegateDescription,
  EFFORT_DESCRIPTION,
  MODEL_DESCRIPTION,
  pendingContext,
  PROMPT_DESCRIPTION,
  WRITABLE_PATHS_DESCRIPTION,
} from '../src/host/prompt.ts'

describe('guidance', () => {
  it('tells a delegating agent how children run, what cwd and writable_paths mean, and how to manage access', () => {
    for (const tool of ['delegate', 'delegate_fork'] as const) {
      const text = delegateDescription(tool, 'Model: X.')
      expect(text).toContain('`send_message`')
      expect(text).toContain('`cwd` you pass becomes the child\'s sub-workspace')
      for (const name of ['answer_write_request', 'grant_write_access', 'revoke_write_access']) expect(text).toContain(`\`${name}\``)
      expect(text).toContain('confined the same way')
      expect(text).toContain('Model: X.')
    }
    expect(delegateDescription('delegate', '')).toContain('self-contained task')
    expect(delegateDescription('delegate_fork', '')).toContain('inherits this conversation')
    expect(delegateDescription('delegate_fork', '')).toContain('loses the provider-side reuse')
    expect(PROMPT_DESCRIPTION.delegate).toContain('include everything it needs')
    expect(CWD_DESCRIPTION).toContain('created if missing')
    expect(WRITABLE_PATHS_DESCRIPTION).toContain('write and edit tools only')
    expect(MODEL_DESCRIPTION).toContain('"provider/model"')
    expect(EFFORT_DESCRIPTION).toContain('reasoning effort')
    for (const text of [delegateDescription('delegate', ''), CWD_DESCRIPTION, WRITABLE_PATHS_DESCRIPTION]) expect(text).not.toContain('{{')
  })

  it('tells a child its sub-workspace, its grants, and how to ask', () => {
    const text = childContext({ version: 1, child: 'c', parent: 'p', workspace: '/w', grants: [
      { path: '/d', kind: 'dir', requestId: 'wr-1', at: 1 },
      { path: '/f', kind: 'file', requestId: 'wr-1', at: 1 },
    ] })
    expect(text).toContain('Sub-workspace: /w.')
    expect(text).toContain('(any tool): /d')
    expect(text).toContain('not shell commands): /f')
    expect(text).toContain('`request_write_access`')
    expect(text).toContain('`sandbox_permissions`')
    expect(childContext({ version: 1, child: 'c', parent: 'p', workspace: null, grants: [] })).toContain('Sub-workspace: none.')
  })

  it('tells a child on a host whose shell cannot reach grants to use the file tools', () => {
    const text = childContext({ version: 1, child: 'c', parent: 'p', workspace: '/w', grants: [{ path: '/d', kind: 'dir', requestId: 'wr-1', at: 1 }] }, false)
    expect(text).toContain('not shell commands): /d')
    expect(text).not.toContain('(any tool)')
  })

  it('tells an inherited child it shares its parent\'s access and cannot ask for more', () => {
    const text = childContext({ version: 1, child: 'g', parent: 'c', workspace: '/w', grants: [], inherited: true })
    expect(text).toContain('Sub-workspace: /w.')
    expect(text).toContain('cannot ask for more')
    expect(text).not.toContain('`request_write_access`')
  })

  it('lists open requests for the parent, and nothing when there are none', () => {
    expect(pendingContext([])).toBe('')
    const text = pendingContext([{ id: 'wr-1', child: 'c1', parent: 'p', workspace: null, paths: [{ path: '/a', directory: true }], reason: 'why', at: 0 }])
    expect(text).toContain('- wr-1 from c1: /a/ — why')
  })
})
