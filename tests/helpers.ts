import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentLike, WorkingDirectoryLike } from '../src/host/types.ts'

/** A fresh canonical temporary directory. */
export function tempDir(prefix = 'dbs-'): string {
  return realpathSync.native(mkdtempSync(join(tmpdir(), prefix)))
}

/** A top-level agent rooted at `cwd`. */
export function parentAgent(id: string, cwd: string): AgentLike {
  return { id, session: { id, header: { id, cwd } } }
}

/** A subagent child of `parent`; its header cwd is the parent's, as the host copies it. */
export function childAgent(id: string, parent: AgentLike): AgentLike {
  return { id, session: { id, header: { id, cwd: parent.session.header.cwd, parentSession: parent.id, origin: 'subagent' } } }
}

/** A working-directory service backed by a map, falling back to the header cwd. */
export function fakeWorkingDirectory(directories = new Map<string, string>()): WorkingDirectoryLike & { directories: Map<string, string> } {
  return {
    directories,
    get: session => directories.get(session.id) ?? session.header.cwd ?? '/',
    ensure: async agent => directories.get(agent.id) ?? agent.session.header.cwd ?? '/',
  }
}
