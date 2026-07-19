import OpenAI from 'openai';

export type ProviderName = 'openai' | 'groq' | 'deepseek';

const PROVIDERS: Record<ProviderName, { baseURL?: string; envKey: string; defaultModel: string }> = {
  openai: {
    envKey: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o-mini',
  },
  groq: {
    baseURL: 'https://api.groq.com/openai/v1',
    envKey: 'GROQ_API_KEY',
    defaultModel: 'llama-3.3-70b-versatile',
  },
  deepseek: {
    baseURL: 'https://api.deepseek.com',
    envKey: 'DEEPSEEK_API_KEY',
    defaultModel: 'deepseek-chat',
  },
};

export function resolveProvider(): { name: ProviderName; client: OpenAI; model: string } {
  const name = (process.env.LLM_PROVIDER || 'openai') as ProviderName;
  const config = PROVIDERS[name];
  if (!config) {
    throw new Error(`Unknown LLM_PROVIDER: ${name}. Supported: ${Object.keys(PROVIDERS).join(', ')}`);
  }

  const apiKey = process.env[config.envKey] || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(`Missing API key. Set ${config.envKey} (or OPENAI_API_KEY).`);
  }

  const client = new OpenAI({
    apiKey,
    baseURL: config.baseURL,
  });

  const model = process.env.LLM_MODEL || config.defaultModel;
  return { name, client, model };
}
