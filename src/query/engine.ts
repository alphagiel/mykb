// ─────────────────────────────────────────────────────────────────────────
// QUERY PIPELINE — CORE
// hybridSearch(): embeds the question, runs semantic (cosine) + keyword
// (FTS5) search in parallel, dedupes by file+chunk, and returns a merged
// ranked list — this is the "R" in RAG. The three exported entry points all
// build on it:
//   askQuestion  — one-shot CLI `mywj ask`, prints sources to stdout
//   chatTurn     — interactive CLI `mywj chat`, carries conversation history
//   apiChat      — same flow for the web UI, returns structured JSON
// Retrieved chunks are numbered [1][2]... and stitched into a context block
// that's handed to the LLMProvider, which is told to cite those numbers —
// this is the "G" (generation), grounded in retrieved context.
// ─────────────────────────────────────────────────────────────────────────
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

export async function hybridSearch(
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

  const semantic = await store.similaritySearch(queryEmbedding, topK);

  const key = (r: SearchResult) => `${r.filePath}::${r.chunkIndex}`;
  const dedup = new Set<string>();
  const results: SearchResult[] = [];

  for (const r of [...ftsHits.slice(0, topK), ...semantic]) {
    const k = key(r);
    if (!dedup.has(k)) { dedup.add(k); results.push(r); }
  }

  return results;
}

export async function askQuestion(
  question: string,
  embedder: EmbeddingProvider,
  store: VectorStore,
  llm: LLMProvider,
  topK = 5,
  precomputedEmbedding?: number[],
  signal?: AbortSignal
): Promise<UsageStats | null> {
  const chunks = await hybridSearch(question, embedder, store, topK, precomputedEmbedding);

  if (chunks.length === 0) {
    console.log('No relevant information found. Run `ingest <path>` to populate the knowledge base.');
    return null;
  }

  const context = chunks
    .map((c, i) => `[${i + 1}] ${chunkHeader(c)}\n${c.content}`)
    .join('\n\n---\n\n');

  const usage = await llm.answer(question, context, [], signal);

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

export interface ApiChatResult {
  answer: string | null;
  sources: Array<{ filePath: string; indices: number[] }>;
  usage: UsageStats | null;
  updatedHistory: ConversationTurn[];
}

// Same retrieval/answer flow as chatTurn, but returns structured data instead of
// printing to the console — used by the web server.
export async function apiChat(
  question: string,
  embedder: EmbeddingProvider,
  store: VectorStore,
  llm: LLMProvider,
  history: ConversationTurn[] = [],
  topK = 5,
): Promise<ApiChatResult> {
  const searchQuery = history.length ? await rewriteQuery(question, history) : question;
  const chunks = await hybridSearch(searchQuery, embedder, store, topK);

  if (chunks.length === 0) {
    return { answer: null, sources: [], usage: null, updatedHistory: history };
  }

  const context = chunks.map((c, i) => `[${i + 1}] ${chunkHeader(c)}\n${c.content}`).join('\n\n---\n\n');
  const usage = await llm.answer(question, context, history);

  const fileToIndices = new Map<string, number[]>();
  chunks.forEach((c, i) => {
    const existing = fileToIndices.get(c.filePath) ?? [];
    existing.push(i + 1);
    fileToIndices.set(c.filePath, existing);
  });
  const sources = Array.from(fileToIndices, ([filePath, indices]) => ({ filePath, indices }));

  const updatedHistory = usage?.answerText ? [...history, { question, answer: usage.answerText }] : history;
  return { answer: usage?.answerText ?? null, sources, usage, updatedHistory };
}

export async function chatTurn(
  question: string,
  embedder: EmbeddingProvider,
  store: VectorStore,
  llm: LLMProvider,
  history: ConversationTurn[],
  topK = 5,
  signal?: AbortSignal
): Promise<{ usage: UsageStats | null; updatedHistory: ConversationTurn[] }> {
  const searchQuery = await rewriteQuery(question, history);
  const chunks = await hybridSearch(searchQuery, embedder, store, topK);

  if (chunks.length === 0) {
    console.log('No relevant information found in the knowledge base.');
    return { usage: null, updatedHistory: history };
  }

  const context = chunks.map((c, i) => `[${i + 1}] ${chunkHeader(c)}\n${c.content}`).join('\n\n---\n\n');
  const usage = await llm.answer(question, context, history, signal);

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
