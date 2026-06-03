import Anthropic from '@anthropic-ai/sdk';
import { ConversationTurn, LLMProvider, UsageStats } from '../types';

const MODEL = 'claude-opus-4-6';
const SYSTEM = `You are a helpful assistant answering questions from a private knowledge base.
Use only the provided context. If the answer is not there, say so clearly. Be concise.
Each context chunk is prefixed with a number like [1], [2], etc. Cite the relevant source numbers inline in your answer using that notation.`;

export function createAnthropicProvider(apiKey: string): LLMProvider {
  const client = new Anthropic({ apiKey });

  return {
    async answer(question: string, context: string, history: ConversationTurn[] = []): Promise<UsageStats> {
      const messages: Anthropic.MessageParam[] = [];

      for (const turn of history) {
        messages.push({ role: 'user', content: `Question: ${turn.question}` });
        messages.push({ role: 'assistant', content: turn.answer });
      }
      messages.push({ role: 'user', content: `Context:\n${context}\n\nQuestion: ${question}` });

      let answerText = '';
      const stream = client.messages.stream({ model: MODEL, max_tokens: 4096, system: SYSTEM, messages });
      stream.on('text', (delta) => { process.stdout.write(delta); answerText += delta; });
      const final = await stream.finalMessage();
      process.stdout.write('\n');

      return {
        inputTokens: final.usage.input_tokens,
        outputTokens: final.usage.output_tokens,
        answerText,
      };
    },
  };
}
