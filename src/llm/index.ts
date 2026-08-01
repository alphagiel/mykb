// ─────────────────────────────────────────────────────────────────────────
// QUERY PIPELINE — LLM PROVIDER SELECTION
// Picks which LLMProvider answers questions. Priority: Anthropic → OpenAI →
// Ollama (always available, fully local, zero cost — the default so the
// tool works out of the box with no API key). Interactive CLI sessions get
// a picker prompt when more than one key is configured; non-interactive
// callers (the web server) auto-pick the best available option.
// ─────────────────────────────────────────────────────────────────────────
import * as readline from 'readline';
import { LLMProvider } from '../types';

export async function resolveProvider(opts: { interactive?: boolean } = {}): Promise<{ provider: LLMProvider; name: string }> {
  const interactive = opts.interactive ?? true;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const ollamaModel = process.env.OLLAMA_MODEL ?? 'llama3.1:8b';

  const options: { label: string; key: string }[] = [
    { label: `Ollama (${ollamaModel}) — local, free`, key: 'ollama' },
  ];
  if (anthropicKey) options.push({ label: 'Claude (Anthropic)', key: 'anthropic' });
  if (openaiKey)    options.push({ label: 'OpenAI', key: 'openai' });

  // Non-interactive callers (e.g. the web server) can't prompt over stdin — prefer a paid API key if present.
  let chosen = anthropicKey ? 'anthropic' : openaiKey ? 'openai' : 'ollama';

  if (interactive && options.length > 1) {
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

// Image transcription needs a vision-capable model — Ollama's default local
// model (llama3.1:8b) can't process images, so this is Claude/OpenAI only.
export async function resolveVisionProvider(opts: { interactive?: boolean } = {}): Promise<{ provider: LLMProvider; name: string }> {
  const interactive = opts.interactive ?? true;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  const options: { label: string; key: string }[] = [];
  if (anthropicKey) options.push({ label: 'Claude (Anthropic)', key: 'anthropic' });
  if (openaiKey)    options.push({ label: 'OpenAI', key: 'openai' });

  if (options.length === 0) {
    throw new Error(
      'Image ingestion needs a vision-capable provider. Set ANTHROPIC_API_KEY or OPENAI_API_KEY and try again.'
    );
  }

  let chosen = anthropicKey ? 'anthropic' : 'openai';

  if (interactive && options.length > 1) {
    console.log('\nSelect vision provider:');
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
  const { createOpenAIProvider } = await import('./openai');
  return { provider: createOpenAIProvider(openaiKey!), name: 'OpenAI (gpt-4o-mini)' };
}
