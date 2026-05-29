import { EmbeddingProvider, LLMProvider, UsageStats, VectorStore } from '../types';

export async function askQuestion(
  question: string,
  embedder: EmbeddingProvider,
  store: VectorStore,
  llm: LLMProvider,
  topK = 5,
  precomputedEmbedding?: number[]
): Promise<UsageStats | null> {
  const queryEmbedding = precomputedEmbedding ?? await embedder.embed(question);
  const chunks = await store.similaritySearch(queryEmbedding, topK);

  if (chunks.length === 0) {
    console.log('No relevant information found. Run `ingest <path>` to populate the knowledge base.');
    return null;
  }

  const context = chunks
    .map((c, i) => `[${i + 1}] ${c.filePath}\n${c.content}`)
    .join('\n\n---\n\n');

  const usage = await llm.answer(question, context);

  // Group citation indices by file path to deduplicate sources display
  const fileToIndices = new Map<string, number[]>();
  chunks.forEach((c, i) => {
    const existing = fileToIndices.get(c.filePath) ?? [];
    existing.push(i + 1);
    fileToIndices.set(c.filePath, existing);
  });

  const uniqueFiles = fileToIndices.size;
  console.log(`\nSources (${chunks.length} chunks · ${uniqueFiles} ${uniqueFiles === 1 ? 'file' : 'files'}):`);
  fileToIndices.forEach((indices, filePath) => {
    console.log(`  ${indices.map(i => `[${i}]`).join('')} ${filePath}`);
  });

  return usage;
}
