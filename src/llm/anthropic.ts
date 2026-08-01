// LLMProvider: Claude (Anthropic). Streams tokens to stdout as they arrive
// and reports usage (input/output token counts) once the stream completes.
import Anthropic from '@anthropic-ai/sdk';
import { ConversationTurn, LLMProvider, UsageStats } from '../types';

const MODEL = 'claude-opus-4-6';
const TRANSCRIBE_PROMPT = `Transcribe all text visible in this image verbatim, preserving structure (headings, lists, tables) as plain text. If it's a screenshot of a ticket, doc, or UI, include labels and field names. Output only the transcribed content, no commentary.`;
const SYSTEM = `You are a helpful assistant answering questions from a private knowledge base.
Use only the provided context. If the answer is not there, say so clearly. Be concise.
Each context chunk is prefixed with a number like [1], [2], etc. Cite the relevant source numbers inline in your answer using that notation.`;

export function createAnthropicProvider(apiKey: string): LLMProvider {
  const client = new Anthropic({ apiKey });

  return {
    async answer(question: string, context: string, history: ConversationTurn[] = [], signal?: AbortSignal): Promise<UsageStats | null> {
      const messages: Anthropic.MessageParam[] = [];

      for (const turn of history) {
        messages.push({ role: 'user', content: `Question: ${turn.question}` });
        messages.push({ role: 'assistant', content: turn.answer });
      }
      messages.push({ role: 'user', content: `Context:\n${context}\n\nQuestion: ${question}` });

      let answerText = '';
      try {
        const stream = client.messages.stream(
          { model: MODEL, max_tokens: 4096, system: SYSTEM, messages },
          { signal }
        );
        stream.on('text', (delta) => { process.stdout.write(delta); answerText += delta; });
        const final = await stream.finalMessage();
        process.stdout.write('\n');
        return {
          inputTokens: final.usage.input_tokens,
          outputTokens: final.usage.output_tokens,
          answerText,
        };
      } catch (err: unknown) {
        if (signal?.aborted) {
          process.stdout.write('\n[cancelled]\n');
          return null;
        }
        throw err;
      }
    },

    async transcribeImage(imageBase64: string, mediaType: string): Promise<string> {
      const message = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif', data: imageBase64 } },
            { type: 'text', text: TRANSCRIBE_PROMPT },
          ],
        }],
      });
      const textBlock = message.content.find((block): block is Anthropic.TextBlock => block.type === 'text');
      return textBlock?.text ?? '';
    },
  };
}
