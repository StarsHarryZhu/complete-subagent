import { describe, expect, it } from 'vitest'
import { isLegacyHost, ToolRestrictions } from '../src/host/legacy.ts'
import type { AgentLike } from '../src/host/types.ts'
import { parentAgent } from './helpers.ts'

/** An agent whose scoped tools record each filter and lift. */
function agentWithFilters(id = 'a') {
  const active: (readonly string[])[] = []
  const log: string[] = []
  let failing = false
  const agent: AgentLike = {
    ...parentAgent(id, '/'),
    ctx: {
      tools: {
        restrict({ deny }) {
          if (failing) throw new Error('restrict failed')
          active.push(deny)
          log.push(`restrict ${deny.join()}`)
          return () => {
            active.splice(active.indexOf(deny), 1)
            log.push(`lift ${deny.join()}`)
          }
        },
      },
    },
  }
  return { agent, active, log, fail: () => { failing = true } }
}

describe('isLegacyHost', () => {
  it('goes by the method that checks each when', () => {
    expect(isLegacyHost({ resolve: () => undefined })).toBe(false)
    expect(isLegacyHost({})).toBe(true)
  })
})

describe('ToolRestrictions', () => {
  const setup = () => {
    const hidden = new Set(['x'])
    return { hidden, restrictions: new ToolRestrictions(['x', 'y'], tool => !hidden.has(tool)) }
  }

  it('denies what should be hidden and leaves a fitting filter alone', () => {
    const { restrictions } = setup()
    const { agent, active, log } = agentWithFilters()
    restrictions.sync(agent)
    restrictions.sync(agent)
    expect(active).toEqual([['x']])
    expect(log).toEqual(['restrict x'])
  })

  it('replaces a filter that no longer fits, new one first, and removes an empty one', () => {
    const { hidden, restrictions } = setup()
    const { agent, active, log } = agentWithFilters()
    restrictions.sync(agent)
    hidden.add('y')
    restrictions.sync(agent)
    expect(active).toEqual([['x', 'y']])
    expect(log).toEqual(['restrict x', 'restrict x,y', 'lift x'])
    hidden.clear()
    restrictions.sync(agent)
    expect(active).toEqual([])
  })

  it('checks again after a change, for a condition that reads the agent\'s tool view', () => {
    let filtered = true
    const follower = new ToolRestrictions(['leader', 'follower'], (tool, _agent) => tool === 'leader' ? serving : serving && !filtered)
    let serving = false
    const active: (readonly string[])[] = []
    const agent: AgentLike = {
      ...parentAgent('a', '/'),
      ctx: {
        tools: {
          restrict({ deny }) {
            active.push(deny)
            filtered = deny.includes('leader')
            return () => { active.splice(active.indexOf(deny), 1) }
          },
        },
      },
    }
    follower.sync(agent)
    expect(active).toEqual([['leader', 'follower']])
    serving = true
    filtered = true
    follower.sync(agent)
    expect(active).toEqual([])
  })

  it('adds no filter when nothing is hidden, even without scoped tools', () => {
    const { hidden, restrictions } = setup()
    hidden.clear()
    expect(() => restrictions.sync(parentAgent('bare', '/'))).not.toThrow()
  })

  it('keeps the old filter when the new one fails', () => {
    const { hidden, restrictions } = setup()
    const { agent, active, fail } = agentWithFilters()
    restrictions.sync(agent)
    hidden.add('y')
    fail()
    expect(() => restrictions.sync(agent)).toThrow(/restrict failed/u)
    expect(active).toEqual([['x']])
  })

  it('refuses to hide a tool from an agent without scoped tools', () => {
    const { restrictions } = setup()
    expect(() => restrictions.sync(parentAgent('bare', '/'))).toThrow(/no scoped tools/u)
  })

  it('lifts every filter on dispose, but not one of a forgotten agent', () => {
    const { restrictions } = setup()
    const first = agentWithFilters('a')
    const second = agentWithFilters('b')
    restrictions.sync(first.agent)
    restrictions.sync(second.agent)
    restrictions.forget(second.agent)
    restrictions.dispose()
    expect(first.active).toEqual([])
    expect(second.active).toEqual([['x']])
  })
})
