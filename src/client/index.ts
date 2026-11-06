/**
 * complete-subagent browser half: the settings page on the Plugins screen, its
 * copy, and one stylesheet. Each is an effect of this plugin's context and is
 * skipped (logged) if its host seat is missing.
 * @module complete-subagent/client
 */

import { PACKAGE_NAME, PLUGIN_ID } from '../shared/settings.ts'
import type { ClientContextLike, ConfigFormsLike, LocaleLike, RemoteSessionLike, SlotsLike } from './host.ts'
import { en, zh } from './locales.ts'
import { createSettings } from './settings.tsx'
import css from './styles.css'

export const name = PACKAGE_NAME
export const inject = ['slots', 'locale']

/**
 * Register the browser contributions.
 * @param ctx - the plugin's client context.
 */
export function apply(ctx: ClientContextLike): void {
  const slots = ctx.get?.('slots') as SlotsLike | undefined
  const locale = ctx.get?.('locale') as LocaleLike | undefined
  if (slots === undefined) {
    console.error(`${PLUGIN_ID}: the slots service is missing, so the settings page cannot render`)
    return
  }
  // The remote session namespace is its own service and must be injected before use.
  let session: RemoteSessionLike | undefined
  const getSession = (): RemoteSessionLike | undefined => session

  guard('dictionaries', () => {
    if (locale !== undefined) ctx.effect?.(() => locale.register(PACKAGE_NAME, { zh, en }), `${PLUGIN_ID}: dictionaries`)
  })
  guard('styles', () => {
    ctx.effect?.(() => mountStyles(css), `${PLUGIN_ID}: styles`)
  })
  guard('remote', () => {
    ctx.inject?.(['remote', 'remote.session'], (scope) => {
      const service = (scope.get?.('remote') as { session?: RemoteSessionLike } | undefined)?.session
      session = service
      scope.effect?.(() => () => { if (session === service) session = undefined }, `${PLUGIN_ID}: remote session`)
    })
  })
  guard('settings', () => {
    ctx.inject?.(['configForms'], (scope) => {
      const forms = scope.get?.('configForms') as ConfigFormsLike | undefined
      const scopedSlots = (scope.get?.('slots') as SlotsLike | undefined) ?? slots
      if (forms === undefined) return
      const Settings = createSettings(forms.get(PLUGIN_ID), getSession)
      scopedSlots.inject('plugins.bundle.config', () => scopedSlots.register(
        { name: 'plugins.bundle.config', key: PACKAGE_NAME, locale: PACKAGE_NAME },
        Settings,
      ))
    })
  })
}

/** Run one contribution, logging instead of throwing: a throw here fails the page's boot. */
function guard(label: string, run: () => void): void {
  try {
    run()
  } catch (error) {
    console.error(`${PLUGIN_ID}: the ${label} could not be registered`, error)
  }
}

/**
 * Add the plugin's stylesheet, tagged with the plugin id.
 * @param text - the stylesheet.
 * @returns the cleanup that removes it.
 */
function mountStyles(text: string): () => void {
  if (typeof document === 'undefined') return () => undefined
  const style = document.createElement('style')
  style.setAttribute('data-plugin', PACKAGE_NAME)
  style.setAttribute('data-plugin-css', `${PACKAGE_NAME}/styles.css`)
  style.textContent = text
  document.head.appendChild(style)
  return () => { style.remove() }
}
