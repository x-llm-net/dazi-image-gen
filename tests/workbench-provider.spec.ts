import { describe, expect, it } from 'vitest'
import { bindWorkbenchProvider, resolveWorkbenchProvider } from '../src/workbench-provider.js'

function context(provider: Record<string, unknown>) {
  return { settings: { describe: () => [{ ns: 'llm-pi-ai', value: { providers: { 'xiaowen-runtime': provider } } }] } } as never
}

describe('native workbench provider binding', () => {
  it('reads the endpoint and credential ref without exposing the credential', () => {
    const ctx = context({ api: 'openai-completions', apiKeyEnv: 'XIAOWEN_HARNESS_SESSION_KEY', baseURL: 'https://x-llm.net/v1' })
    expect(resolveWorkbenchProvider(ctx, undefined)).toEqual({
      id: 'xiaowen-runtime', api: 'openai-completions', apiKeyEnv: 'XIAOWEN_HARNESS_SESSION_KEY', baseURL: 'https://x-llm.net/v1',
    })
    expect(bindWorkbenchProvider(ctx, { workbenchProvider: 'xiaowen-runtime' })).toEqual({
      workbenchProvider: 'xiaowen-runtime', openaiCompatBaseURL: 'https://x-llm.net/v1', openaiCompatModel: 'gpt-image-2.5',
    })
  })

  it('rejects provider URLs that could carry credentials or leave the safe transport boundary', () => {
    expect(() => resolveWorkbenchProvider(context({ api: 'openai-completions', apiKeyEnv: 'KEY', baseURL: 'https://user:pass@example.test/v1' }), undefined)).toThrow(/不受支持/)
    expect(() => resolveWorkbenchProvider(context({ api: 'openai-completions', apiKeyEnv: 'KEY', baseURL: 'http://10.0.0.2/v1' }), undefined)).toThrow(/不受支持/)
  })
})
