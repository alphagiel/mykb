import { EmbeddingProvider, LLMProvider, UsageStats, VectorStore } from '../types';

export async function askQuestion(
  question: string,
  embedder: EmbeddingProvider,
  store: VectorStore,
  llm: LLMProvider,
  topK = 5
): Promise<UsageStats | null> {
  const queryEmbedding = await embedder.embed(question);
  const chunks = await store.similaritySearch(queryEmbedding, topK);

  if (chunks.length === 0) {
    console.log('No relevant information found. Run `ingest <path>` to populate the knowledge base.');
    return null;
  }

  const context = chunks
    .map((c, i) => `[${i + 1}] ${c.filePath}\n${c.content}`)
    .join('\n\n---\n\n');

  const usage = await llm.answer(question, context);

  console.log('\nSources:');
  chunks.forEach((c, i) => console.log(`  [${i + 1}] ${c.filePath}`));

  return usage;
}
