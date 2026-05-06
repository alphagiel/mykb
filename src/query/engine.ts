import { EmbeddingProvider, LLMProvider, VectorStore } from '../types';

const TOP_K = 7;

export async function askQuestion(
  question: string,
  embedder: EmbeddingProvider,
  store: VectorStore,
  llm: LLMProvider
): Promise<void> {
  const queryEmbedding = await embedder.embed(question);
  const chunks = await store.similaritySearch(queryEmbedding, TOP_K);

  if (chunks.length === 0) {
    console.log('No relevant information found. Run `ingest <path>` to populate the knowledge base.');
    return;
  }

  const context = chunks
    .map((c, i) => `[${i + 1}] ${c.filePath}\n${c.content}`)
    .join('\n\n---\n\n');

  await llm.answer(question, context);
}
