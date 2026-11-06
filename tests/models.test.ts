import { describe, expect, it } from 'vitest'
import { chooseRoute, describeModels, routeOf } from '../src/host/models.ts'
import type { ChildModel } from '../src/shared/settings.ts'
import type { AgentLike, LlmLike, RouteLike } from '../src/host/types.ts'

/** A parent whose session's current route is `route`. */
function parentOn(route: RouteLike | undefined, options?: AgentLike['options']): AgentLike {
  return { id: 'p1', options, session: { id: 'p1', header: { id: 'p1' }, requestHeader: () => route === undefined ? undefined : { config: route } } }
}

/** An LLM runtime advertising `off/low/high/max` (default `high`) for every model, recording preflights. */
function fakeLlm(efforts = ['off', 'low', 'high', 'max'], defaultEffort = 'high') {
  const preflights: RouteLike[] = []
  const llm: LlmLike = {
    resolveModelInfo: async () => ({ reasoning: { efforts: efforts.map(id => ({ id })), defaultEffort } }),
    resolveCallConfig: async (config) => { preflights.push(config); return config },
  }
  return { llm, preflights }
}

const PRO: ChildModel = { provider: 'ds', model: 'pro', reasoningEfforts: ['high', 'max'] }
const MINI: ChildModel = { provider: 'ds', model: 'mini', reasoningEfforts: [] }
const parent = parentOn({ provider: 'ds', model: 'flash', reasoningEffort: 'max' })

describe('routeOf', () => {
  it('reads the request header first and the creation options before the first request', () => {
    expect(routeOf(parent)).toEqual({ provider: 'ds', model: 'flash', reasoningEffort: 'max' })
    expect(routeOf(parentOn(undefined, { provider: 'a', model: 'b' }))).toEqual({ provider: 'a', model: 'b' })
    expect(routeOf(parentOn(undefined))).toBeUndefined()
  })
})

describe('chooseRoute', () => {
  const choose = (request: Record<string, unknown>, models: ChildModel[] = [PRO, MINI], llm = fakeLlm().llm, from = parent) =>
    chooseRoute({ parent: from, models, request, llm })

  it('inherits everything when the call selects nothing', async () => {
    await expect(choose({})).resolves.toBeUndefined()
  })

  it('sets any advertised effort on the parent\'s own unlisted model', async () => {
    const { llm, preflights } = fakeLlm()
    await expect(choose({ reasoning_effort: 'low' }, [PRO], llm)).resolves.toEqual({ provider: 'ds', model: 'flash', reasoningEffort: 'low' })
    expect(preflights).toEqual([{ provider: 'ds', model: 'flash', reasoningEffort: 'low' }])
    await expect(choose({ reasoning_effort: 'ultra' }, [PRO])).rejects.toThrow(/not offered for ds\/flash\. Choose one of: off, low, high, max/u)
  })

  it('limits the parent\'s own model to its listed efforts when it is listed', async () => {
    const own: ChildModel = { provider: 'ds', model: 'flash', reasoningEfforts: ['low'] }
    await expect(choose({ reasoning_effort: 'max' }, [own])).rejects.toThrow(/Choose one of: low\./u)
    await expect(choose({ model: 'ds/flash', reasoning_effort: 'low' }, [own])).resolves.toMatchObject({ reasoningEffort: 'low' })
  })

  it('switches to a listed model, within its listed efforts', async () => {
    await expect(choose({ model: 'ds/pro', reasoning_effort: 'max' })).resolves.toEqual({ provider: 'ds', model: 'pro', reasoningEffort: 'max' })
    await expect(choose({ model: 'ds/pro', reasoning_effort: 'low' })).rejects.toThrow(/Choose one of: high, max\./u)
    await expect(choose({ model: 'ds/mini', reasoning_effort: 'off' })).resolves.toMatchObject({ model: 'mini', reasoningEffort: 'off' })
  })

  it('uses the model default on another model, or its first listed effort when the default is not listed', async () => {
    const { llm, preflights } = fakeLlm(['off', 'low', 'high', 'max'], 'high')
    await expect(choose({ model: 'ds/mini' }, [PRO, MINI], llm)).resolves.toEqual({ provider: 'ds', model: 'mini' })
    expect(preflights.at(-1)).toEqual({ provider: 'ds', model: 'mini' })
    const narrow: ChildModel = { provider: 'ds', model: 'pro', reasoningEfforts: ['low', 'max'] }
    await expect(choose({ model: 'ds/pro' }, [narrow])).resolves.toEqual({ provider: 'ds', model: 'pro', reasoningEffort: 'low' })
    await expect(choose({ model: 'ds/pro' }, [PRO])).resolves.toEqual({ provider: 'ds', model: 'pro' })
  })

  it('keeps the parent\'s effort when the parent names its own model', async () => {
    const { llm, preflights } = fakeLlm()
    await expect(choose({ model: 'ds/flash' }, [PRO], llm)).resolves.toEqual({ provider: 'ds', model: 'flash' })
    expect(preflights).toEqual([{ provider: 'ds', model: 'flash', reasoningEffort: 'max' }])
  })

  it('refuses unlisted models, empty ids, models without efforts, and a missing runtime', async () => {
    await expect(choose({ model: 'other/x' })).rejects.toThrow(/not offered for subagents\. Choose one of: ds\/pro, ds\/mini/u)
    await expect(choose({ model: 'other/x' }, [])).rejects.toThrow(/none are listed in the settings/u)
    await expect(choose({ reasoning_effort: '' })).rejects.toThrow(/non-empty id/u)
    await expect(choose({ reasoning_effort: 'low' }, [], fakeLlm([]).llm)).rejects.toThrow(/no selectable reasoning effort/u)
    await expect(chooseRoute({ parent, models: [], request: { reasoning_effort: 'low' }, llm: undefined })).rejects.toThrow(/`llm` service/u)
    await expect(choose({ reasoning_effort: 'low' }, [], fakeLlm().llm, parentOn(undefined))).rejects.toThrow(/not known yet/u)
  })

  it('passes the route preflight failure through', async () => {
    const llm: LlmLike = { ...fakeLlm().llm, resolveCallConfig: async () => { throw new Error('unknown model') } }
    await expect(choose({ model: 'ds/pro', reasoning_effort: 'high' }, [PRO], llm)).rejects.toThrow('unknown model')
  })
})

describe('chooseRoute with ownModel off', () => {
  const choose = (request: Record<string, unknown>, models: ChildModel[] = [PRO, MINI], llm = fakeLlm().llm, from = parent) =>
    chooseRoute({ parent: from, models, request, llm, ownModel: false })

  it('uses the first listed model when the call names none', async () => {
    const { llm, preflights } = fakeLlm()
    await expect(choose({}, [MINI, PRO], llm)).resolves.toEqual({ provider: 'ds', model: 'mini' })
    expect(preflights).toEqual([{ provider: 'ds', model: 'mini' }])
  })

  it('needs nothing from the parent, whose route may not be known yet', async () => {
    await expect(choose({}, [MINI], fakeLlm().llm, parentOn(undefined))).resolves.toEqual({ provider: 'ds', model: 'mini' })
  })

  it('sets an effort-only call on the first listed model, within its efforts', async () => {
    await expect(choose({ reasoning_effort: 'max' })).resolves.toEqual({ provider: 'ds', model: 'pro', reasoningEffort: 'max' })
    await expect(choose({ reasoning_effort: 'low' })).rejects.toThrow(/not offered for ds\/pro\. Choose one of: high, max\./u)
  })

  it('follows the listed efforts when the call names none', async () => {
    const narrow: ChildModel = { provider: 'ds', model: 'pro', reasoningEfforts: ['low', 'max'] }
    await expect(choose({}, [narrow])).resolves.toEqual({ provider: 'ds', model: 'pro', reasoningEffort: 'low' })
    await expect(choose({}, [PRO])).resolves.toEqual({ provider: 'ds', model: 'pro' })
  })

  it('refuses the parent\'s own model when it is not listed, naming the choices', async () => {
    await expect(choose({ model: 'ds/flash' })).rejects.toThrow(/"ds\/flash" is not offered for subagents\. Choose one of: ds\/pro, ds\/mini/u)
    await expect(choose({ model: 'ds/flash', reasoning_effort: 'low' })).rejects.not.toThrow(/your own/u)
    await expect(choose({ model: 'other/x' })).rejects.toThrow(/omit `model` to use the first/u)
  })

  it('never hands down the parent\'s effort when the parent runs a listed model', async () => {
    const own: ChildModel = { provider: 'ds', model: 'flash', reasoningEfforts: [] }
    const { llm, preflights } = fakeLlm()
    await expect(choose({}, [own], llm)).resolves.toEqual({ provider: 'ds', model: 'flash', reasoningEffort: 'high' })
    expect(preflights).toEqual([{ provider: 'ds', model: 'flash', reasoningEffort: 'high' }])
    const narrow: ChildModel = { provider: 'ds', model: 'flash', reasoningEfforts: ['low'] }
    await expect(choose({ model: 'ds/flash' }, [narrow])).resolves.toEqual({ provider: 'ds', model: 'flash', reasoningEffort: 'low' })
  })

  it('leaves the usual rules when the list is empty', async () => {
    await expect(choose({}, [])).resolves.toBeUndefined()
    await expect(choose({ reasoning_effort: 'low' }, [])).resolves.toEqual({ provider: 'ds', model: 'flash', reasoningEffort: 'low' })
  })
})

describe('describeModels', () => {
  it('names the list and the first model as the default with ownModel off', () => {
    const text = describeModels([PRO, MINI], false)
    expect(text).toContain('never your own')
    expect(text).toContain('Omit `model` to use the first')
    expect(text).toContain('- ds/pro: efforts high, max')
    expect(text).not.toContain('give the child your own model')
    expect(describeModels([], false)).toBe(describeModels([]))
  })

  it('says the child keeps the parent\'s model when nothing is listed', () => {
    expect(describeModels([])).toMatch(/^Model: the child uses your own model\./u)
  })

  it('lists every choice with its efforts', () => {
    const text = describeModels([PRO, MINI])
    expect(text).toContain('- ds/pro: efforts high, max')
    expect(text).toContain('- ds/mini: any effort it supports')
    expect(text).toContain('first listed effort')
  })
})
