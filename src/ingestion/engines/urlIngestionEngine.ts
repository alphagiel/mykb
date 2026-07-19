// ─────────────────────────────────────────────────────────────────────────
// URL INGESTION PIPELINE — ORCHESTRATOR
// Mirrors ingestionEngine.ts but for a single URL instead of a folder scan:
//   fetch → extract → normalize → dedup (content hash) → chunk → embed → store
// The URL itself plays the role a file path plays in the file pipeline, so
// VectorStore, chunker.ts, and normalize() are reused unchanged.
// ─────────────────────────────────────────────────────────────────────────
import { EmbeddingProvider, FileMetadata, VectorStore } from '../../types';
import { fetchUrl } from '../web/fetcher';
import { extract } from '../web/extractor';
import { normalize } from '../normalizer';
import { chunkDocument } from '../chunker';

export interface UrlIngestionResult {
  ingested: boolean;
  skipped: boolean;
  title?: string;
  chunkCount?: number;
}

export async function runUrlIngestion(
  url: string,
  embedder: EmbeddingProvider,
  store: VectorStore
): Promise<UrlIngestionResult> {
  const page = await fetchUrl(url);
  const { title, textContent } = extract(page);
  const doc = normalize(textContent, page.finalUrl);
  const finalUrl = page.finalUrl;

  if (await store.documentExists(finalUrl, doc.metadata.contentHash)) {
    return { ingested: false, skipped: true, title };
  }

  await store.deleteDocument(finalUrl);

  const now = new Date();
  const meta: FileMetadata = {
    createdAt: now,
    modifiedAt: now,
    sizeBytes: Buffer.byteLength(doc.content, 'utf-8'),
  };
  const documentId = await store.addDocument(finalUrl, doc.metadata.contentHash, meta);
  const chunks = chunkDocument(doc.content, documentId);

  for (const chunk of chunks) {
    const textToEmbed = `Source: ${title}\n${chunk.content}`;
    const embedding = await embedder.embed(textToEmbed);
    await store.addChunk(documentId, chunk.content, embedding, chunk.chunkIndex);
  }

  return { ingested: true, skipped: false, title, chunkCount: chunks.length };
}
