import type { Context } from '@deepseek-ai/cordis'

/** The small part of a native Harness provider needed by image generation. */
export interface WorkbenchProvider {
  id: string
  api: string
  apiKeyEnv: string
  baseURL: string
}

const ALLOWED_APIS = new Set(['openai-completions', 'openai-responses'])

/**
 * Read a provider from the native model settings service.  The image plugin
 * stores only this provider id; the endpoint and credential remain owned by
 * the workbench's normal model settings and credential store.
 */
export function resolveWorkbenchProvider(ctx: Context, providerId: unknown): WorkbenchProvider | undefined {
  const settings = (ctx as Context & { settings?: { describe?: () => readonly unknown[] } }).settings
  const rows = typeof settings?.describe === 'function' ? settings.describe() : []
  const row = rows.find(candidate => {
    if (typeof candidate !== 'object' || candidate === null) return false
    return (candidate as { ns?: unknown }).ns === 'llm-pi-ai'
  }) as { value?: { providers?: Record<string, unknown> } } | undefined
  const providers = row?.value?.providers
  if (providers === undefined) return undefined
  const requested = typeof providerId === 'string' ? providerId.trim() : ''
  // Dazi ships its native provider under this id. Auto-detecting it keeps a
  // normal plugin install usable without asking the user to copy an internal
  // provider id; an explicit id still wins when one is configured.
  const selectedId = requested || (Object.hasOwn(providers, 'xiaowen-runtime') ? 'xiaowen-runtime' : '')
  if (selectedId.length === 0) return undefined
  const value = providers[selectedId]
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as { api?: unknown; apiKeyEnv?: unknown; baseURL?: unknown }
  if (typeof record.api !== 'string' || !ALLOWED_APIS.has(record.api)
    || typeof record.apiKeyEnv !== 'string' || record.apiKeyEnv.trim().length === 0
    || typeof record.baseURL !== 'string') return undefined
  const baseURL = validateBaseURL(record.baseURL)
  return { id: selectedId, api: record.api, apiKeyEnv: record.apiKeyEnv.trim(), baseURL }
}

/** Apply the selected native provider to the OpenAI-compatible request row. */
export function bindWorkbenchProvider(ctx: Context, config: { workbenchProvider?: unknown; openaiCompatModel?: unknown }) {
  const provider = resolveWorkbenchProvider(ctx, config.workbenchProvider)
  if (provider === undefined) return config
  const model = typeof config.openaiCompatModel === 'string' && config.openaiCompatModel.trim().length > 0
    ? config.openaiCompatModel.trim()
    : 'gpt-image-2.5'
  return { ...config, openaiCompatBaseURL: provider.baseURL, openaiCompatModel: model }
}

function validateBaseURL(raw: string): string {
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('搭子模型提供商的服务地址无效。') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
    || (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('搭子模型提供商的服务地址不受支持。')
  }
  return url.href.replace(/\/+$/, '')
}
