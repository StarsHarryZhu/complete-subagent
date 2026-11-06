/**
 * Settings page copy.
 * @module complete-subagent/client/locales
 */

export const zh: Record<string, string> = {
  'settings.summary.none': '子代理只用父代理自己的模型',
  'settings.summary.some': '可为子代理选择 {count} 个模型',
  'settings.models': '可选的子代理模型',
  'settings.models.hint': '父代理派生子代理时，只能从这里选模型。父代理自己的模型总能用：不在列表里时可选它支持的全部推理强度，在列表里就只能选勾选的强度。',
  'settings.models.empty': '还没有添加模型，子代理只用父代理自己的模型，推理强度可以调。',
  'settings.efforts': '允许的推理强度',
  'settings.efforts.all': '不勾选就是全部',
  'settings.efforts.none': '这个模型没有可选的推理强度',
  'settings.unavailable': '当前不可用',
  'settings.remove': '移除',
  'settings.add': '添加',
  'settings.add.placeholder': '选择要添加的模型',
  'settings.timeout': '写入申请的等待时间（秒）',
  'settings.timeout.hint': '子代理申请写入后，父代理超过这个时间没回复就按拒绝处理。最少 {min} 秒。',
  'settings.save': '保存',
  'settings.saved': '已保存，AI 的下一步起生效',
  'settings.failed': '保存失败，请重试。',
  'settings.readonly': '当前配置文件不可写。',
  'settings.loading': '正在读取…',
  'settings.catalogFailed': '读取模型列表失败，已保存的模型仍会保留。',
}

export const en: Record<string, string> = {
  'settings.summary.none': 'Children use their parent\'s model',
  'settings.summary.some': '{count} models to choose for children',
  'settings.models': 'Models for subagents',
  'settings.models.hint': 'A parent can choose a child\'s model only from this list. Its own model is always available: with every effort it supports when it is not listed, with the checked efforts when it is.',
  'settings.models.empty': 'No models yet: children use their parent\'s model, and the parent can still set the reasoning effort.',
  'settings.efforts': 'Allowed reasoning efforts',
  'settings.efforts.all': 'None checked means all',
  'settings.efforts.none': 'This model has no selectable reasoning effort',
  'settings.unavailable': 'Unavailable',
  'settings.remove': 'Remove',
  'settings.add': 'Add',
  'settings.add.placeholder': 'Choose a model to add',
  'settings.timeout': 'Write-access answer time (seconds)',
  'settings.timeout.hint': 'A request the parent does not answer within this time counts as denied. At least {min} seconds.',
  'settings.save': 'Save',
  'settings.saved': 'Saved; it applies from the next step',
  'settings.failed': 'Saving failed. Try again.',
  'settings.readonly': 'The profile is read-only.',
  'settings.loading': 'Loading…',
  'settings.catalogFailed': 'The model list could not be loaded; saved models are kept.',
}

/**
 * Translator used when the locale service is missing.
 * @param key - message key.
 * @param params - interpolation values.
 * @returns the English text.
 */
export function fallbackT(key: string, params?: Record<string, unknown>): string {
  const text = en[key] ?? key
  return params === undefined ? text : text.replace(/\{(\w+)\}/gu, (match, name: string) => (name in params ? String(params[name]) : match))
}
