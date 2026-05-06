import { Chunk } from '../types';

// ~4 chars per token is a reasonable approximation without a tokenizer dependency
const CHARS_PER_TOKEN = 4;
const DEFAULT_CHUNK_TOKENS = 900;
const DEFAULT_OVERLAP_TOKENS = 100;

export interface ChunkOptions {
  chunkTokens?: number;
  overlapTokens?: number;
}

export function chunkDocument(
  content: string,
  documentId: number,
  options: ChunkOptions = {}
): Chunk[] {
  const chunkSize = (options.chunkTokens ?? DEFAULT_CHUNK_TOKENS) * CHARS_PER_TOKEN;
  const overlap = (options.overlapTokens ?? DEFAULT_OVERLAP_TOKENS) * CHARS_PER_TOKEN;

  const chunks: Chunk[] = [];
  let start = 0;
  let index = 0;

  while (start < content.length) {
    const end = Math.min(start + chunkSize, content.length);
    const slice = content.slice(start, end).trim();

    if (slice.length > 0) {
      chunks.push({ documentId, content: slice, chunkIndex: index++ });
    }

    if (end >= content.length) break;
    start = end - overlap;
  }

  return chunks;
}
