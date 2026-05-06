import Anthropic from '@anthropic-ai/sdk';
import { EmbeddingProvider, VectorStore } from '../types';

const TOP_K = 7;
const MODEL = 'claude-opus-4-6';

export async function askQuestion(
  question: string,
  embedder: EmbeddingProvider,
  store: VectorStore,
  apiKey: string
): Promise<void> {
  const queryEmbedding = await embedder.embed(question);
  const chunks = await store.similaritySearch(queryEmbedding, TOP_K);

  if (chunks.length === 0) {
    console.log('No relevant information found. Run `mykb ingest <path>` to populate the knowledge base.');
    return;
  }

  const context = chunks
    .map((c, i) => `[${i + 1}] ${c.filePath}\n${c.content}`)
    .join('\n\n---\n\n');

  const client = new Anthropic({ apiKey });

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 4096,
    system: `You are a helpful assistant answering questions from a private knowledge base.
Use only the provided context. If the answer is not there, say so clearly. Be concise.`,
    messages: [
      {
        role: 'user',
        content: `Context:\n${context}\n\nQuestion: ${question}`,
      },
    ],
  });

  stream.on('text', (delta) => process.stdout.write(delta));
  await stream.finalMessage();
  process.stdout.write('\n');
}
