import { LLMProvider } from '../types';

export async function resolveProvider(): Promise<{ provider: LLMProvider; name: string }> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const ollamaModel = process.env.OLLAMA_MODEL;

  if (anthropicKey) {
    const { createAnthropicProvider } = await import('./anthropic');
    return { provider: createAnthropicProvider(anthropicKey), name: `Claude (claude-opus-4-6)` };
  }

  if (openaiKey) {
    const { createOpenAIProvider } = await import('./openai');
    return { provider: createOpenAIProvider(openaiKey), name: 'OpenAI (gpt-4o-mini)' };
  }

  if (ollamaModel) {
    const { createOllamaProvider } = await import('./ollama');
    return { provider: createOllamaProvider(ollamaModel), name: `Ollama (${ollamaModel})` };
  }

  throw new Error(
    'No LLM provider configured.\n' +
    'Set one of the following in your .env file:\n' +
    '  ANTHROPIC_API_KEY=sk-ant-...   (Claude)\n' +
    '  OPENAI_API_KEY=sk-...          (OpenAI)\n' +
    '  OLLAMA_MODEL=llama3.2          (local, no API key)'
  );
}
