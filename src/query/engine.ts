import * as path from 'path';
import { ConversationTurn, EmbeddingProvider, LLMProvider, SearchResult, UsageStats, VectorStore } from '../types';
import { rewriteQuery } from './rewriter';

function chunkHeader(c: SearchResult): string {
  const name = path.basename(c.filePath);
  const fmt  = (d: Date) => d.toISOString().slice(0, 10);
  const parts = [`File: ${name}`];
  if (c.fileCreatedAt)  parts.push(`Created: ${fmt(c.fileCreatedAt)}`);
  if (c.fileModifiedAt) parts.push(`Modified: ${fmt(c.fileModifiedAt)}`);
  return parts.join(' | ');
}

async function hybridSearch(
  question: string,
  embedder: EmbeddingProvider,
  store: VectorStore,
  topK: number,
  precomputedEmbedding?: number[],
): Promise<SearchResult[]> {
  const [ftsHits, queryEmbedding] = await Promise.all([
    store.ftsSearch(question),
    precomputedEmbedding ? Promise.resolve(precomputedEmbedding) : embedder.embed(question),
  ]);

  const dedup = new Set<string>();
  const key = (r: SearchResult) => `${r.filePath}::${r.chunkIndex}`;

  const pinned = ftsHits.filter(h => {
    const k = key(h);
    if (dedup.has(k)) return false;
    dedup.add(k);
    return true;
  }).slice(0, topK);

  const remaining = Math.max(0, topK - pinned.length);
  if (remaining === 0) return pinned;

  const semantic = await store.similaritySearch(queryEmbedding, topK);
  const extra = semantic.filter(s => !dedup.has(key(s))).slice(0, remaining);

  return [...pinned, ...extra];
}

export async function askQuestion(
  question: string,
  embedder: EmbeddingProvider,
  store: VectorStore,
  llm: LLMProvider,
  topK = 5,
  precomputedEmbedding?: number[]
): Promise<UsageStats | null> {
  const chunks = await hybridSearch(question, embedder, store, topK, precomputedEmbedding);

  if (chunks.length === 0) {
    console.log('No relevant information found. Run `ingest <path>` to populate the knowledge base.');
    return null;
  }

  const context = chunks
    .map((c, i) => `[${i + 1}] ${chunkHeader(c)}\n${c.content}`)
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

export async function chatTurn(
  question: string,
  embedder: EmbeddingProvider,
  store: VectorStore,
  llm: LLMProvider,
  history: ConversationTurn[],
  topK = 5,
): Promise<{ usage: UsageStats | null; updatedHistory: ConversationTurn[] }> {
  const searchQuery = await rewriteQuery(question, history);
  const chunks = await hybridSearch(searchQuery, embedder, store, topK);

  if (chunks.length === 0) {
    console.log('No relevant information found in the knowledge base.');
    return { usage: null, updatedHistory: history };
  }

  const context = chunks.map((c, i) => `[${i + 1}] ${chunkHeader(c)}\n${c.content}`).join('\n\n---\n\n');
  const usage = await llm.answer(question, context, history);

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

  const updatedHistory = usage?.answerText
    ? [...history, { question, answer: usage.answerText }]
    : history;

  return { usage, updatedHistory };
}
