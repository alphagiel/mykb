import OpenAI from 'openai';
import { ConversationTurn, LLMProvider, UsageStats } from '../types';

const MODEL = 'gpt-4o-mini';
const SYSTEM = `You are a helpful assistant answering questions from a private knowledge base.
Use only the provided context. If the answer is not there, say so clearly. Be concise.
Each context chunk is prefixed with a number like [1], [2], etc. Cite the relevant source numbers inline in your answer using that notation.`;

export function createOpenAIProvider(apiKey: string): LLMProvider {
  const client = new OpenAI({ apiKey });

  return {
    async answer(question: string, context: string, history: ConversationTurn[] = []): Promise<UsageStats> {
      const messages: OpenAI.ChatCompletionMessageParam[] = [{ role: 'system', content: SYSTEM }];

      for (const turn of history) {
        messages.push({ role: 'user', content: `Question: ${turn.question}` });
        messages.push({ role: 'assistant', content: turn.answer });
      }
      messages.push({ role: 'user', content: `Context:\n${context}\n\nQuestion: ${question}` });

      const stream = await client.chat.completions.create({ model: MODEL, stream: true, stream_options: { include_usage: true }, messages });

      let inputTokens = 0;
      let outputTokens = 0;
      let answerText = '';

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? '';
        if (delta) { process.stdout.write(delta); answerText += delta; }
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens;
          outputTokens = chunk.usage.completion_tokens;
        }
      }
      process.stdout.write('\n');

      return { inputTokens, outputTokens, answerText };
    },
  };
}
