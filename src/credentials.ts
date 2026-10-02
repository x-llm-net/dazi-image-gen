/** Shared BYOK credential resolution for the Agent tools and the Studio route. */
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { Context } from '@deepseek-ai/cordis'
import { CLOUD_CREDENTIAL_REFS, PROVIDER_DISPLAY_NAMES, type CloudImageProvider } from './shared.js'
import { resolveWorkbenchProvider } from './workbench-provider.js'
import type { Config } from './config.js'

/**
 * Resolve one provider's stored API key to a non-blank value. Blank values
 * never count as configured: the host treats an empty stored value as absent,
 * and a whitespace-only key is never sent to a provider.
 */
export async function resolveApiKey(ctx: Context, provider: CloudImageProvider, config?: Config): Promise<string | undefined> {
  const workbench = provider === 'openai-compat' ? resolveWorkbenchProvider(ctx, config?.workbenchProvider) : undefined
  const reference = credentialRef(workbench?.apiKeyEnv ?? CLOUD_CREDENTIAL_REFS[provider])
  const credential = await ctx.credentials.resolve(reference)
  const value = credential?.value.trim() ?? ''
  return value.length > 0 ? value : undefined
}

/**
 * Resolve one provider's API key or fail with a user-facing message that says
 * where to configure it. Passing `tool` selects the Agent-facing English
 * wording; without it the message is the browser-facing Chinese one used by
 * the Studio route.
 */
export async function requireApiKey(ctx: Context, provider: CloudImageProvider, tool?: string, config?: Config): Promise<string> {
  const value = await resolveApiKey(ctx, provider, config)
  if (value !== undefined) return value
  const workbench = provider === 'openai-compat' ? resolveWorkbenchProvider(ctx, config?.workbenchProvider) : undefined
  if (workbench !== undefined) {
    throw new Error(tool === undefined
      ? '搭子当前模型提供商尚未配置 API Key，请先到设置 > 模型配置中检查。'
      : `${tool} requires the API key configured for the selected 搭子 model provider.`)
  }
  throw new Error(tool === undefined
    ? `${PROVIDER_DISPLAY_NAMES[provider]} 尚未配置 API Key，请先到 设置 > 插件 > 图像生成 配置`
    : `${tool} requires the ${PROVIDER_DISPLAY_NAMES[provider]} API key; configure it in Settings > Plugins > Image generation.`)
}
