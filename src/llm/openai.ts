import OpenAI from 'openai';
import { LLMProvider } from '../types';

const MODEL = 'gpt-4o-mini';
const SYSTEM = `You are a helpful assistant answering questions from a private knowledge base.
Use only the provided context. If the answer is not there, say so clearly. Be concise.
Each context chunk is prefixed with a number like [1], [2], etc. Cite the relevant source numbers inline in your answer using that notation.`;

export function createOpenAIProvider(apiKey: string): LLMProvider {
  const client = new OpenAI({ apiKey });

  return {
    async answer(question: string, context: string): Promise<void> {
      const stream = await client.chat.completions.create({
        model: MODEL,
        stream: true,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Context:\n${context}\n\nQuestion: ${question}` },
        ],
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? '';
        if (delta) process.stdout.write(delta);
      }
      process.stdout.write('\n');
    },
  };
}
