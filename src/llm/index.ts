import * as readline from 'readline';
import { LLMProvider } from '../types';

export async function resolveProvider(): Promise<{ provider: LLMProvider; name: string }> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const ollamaModel = process.env.OLLAMA_MODEL ?? 'llama3.1:8b';

  const options: { label: string; key: string }[] = [
    { label: `Ollama (${ollamaModel}) — local, free`, key: 'ollama' },
  ];
  if (anthropicKey) options.push({ label: 'Claude (Anthropic)', key: 'anthropic' });
  if (openaiKey)    options.push({ label: 'OpenAI', key: 'openai' });

  let chosen = 'ollama';

  if (options.length > 1) {
    console.log('\nSelect LLM provider:');
    options.forEach((o, i) => console.log(`  ${i + 1}. ${o.label}`));
    console.log();

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const pick = await new Promise<string>(resolve =>
      rl.question('Pick [1]: ', line => { rl.close(); resolve(line.trim() || '1'); })
    );
    const idx = parseInt(pick, 10) - 1;
    chosen = options[Math.max(0, Math.min(idx, options.length - 1))].key;
    console.log();
  }

  if (chosen === 'anthropic') {
    const { createAnthropicProvider } = await import('./anthropic');
    return { provider: createAnthropicProvider(anthropicKey!), name: 'Claude (claude-opus-4-6)' };
  }
  if (chosen === 'openai') {
    const { createOpenAIProvider } = await import('./openai');
    return { provider: createOpenAIProvider(openaiKey!), name: 'OpenAI (gpt-4o-mini)' };
  }

  const { createOllamaProvider } = await import('./ollama');
  return { provider: createOllamaProvider(ollamaModel), name: `Ollama (${ollamaModel})` };
}
