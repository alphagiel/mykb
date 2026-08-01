// ─────────────────────────────────────────────────────────────────────────
// URL INGESTION PIPELINE — ORCHESTRATOR
// Mirrors ingestionEngine.ts but for a single URL instead of a folder scan:
//   fetch → extract → normalize → dedup (content hash) → chunk → embed → store
// The URL itself plays the role a file path plays in the file pipeline, so
// VectorStore, chunker.ts, and normalize() are reused unchanged.
// ─────────────────────────────────────────────────────────────────────────
import { DocumentRef, EmbeddingProvider, FileMetadata, VectorStore } from '../../types';
import { fetchUrl } from '../web/fetcher';
import { extract } from '../web/extractor';
import { normalize } from '../normalizer';
import { writeDocument } from '../documentWriter';

export interface UrlIngestionResult {
  ingested: boolean;
  skipped: boolean;
  title?: string;
  chunkCount?: number;
  merged?: boolean;
  mergedInto?: string;
}

export async function runUrlIngestion(
  url: string,
  embedder: EmbeddingProvider,
  store: VectorStore,
  titleOverride?: string,
  onRelatedDocumentFound?: (match: DocumentRef) => Promise<boolean>
): Promise<UrlIngestionResult> {
  const page = await fetchUrl(url);
  const extracted = extract(page);
  const title = titleOverride || extracted.title;
  const doc = normalize(extracted.textContent, page.finalUrl);
  const finalUrl = page.finalUrl;

  if (await store.documentExists(finalUrl, doc.metadata.contentHash)) {
    return { ingested: false, skipped: true, title };
  }

  const now = new Date();
  const meta: FileMetadata = {
    createdAt: now,
    modifiedAt: now,
    sizeBytes: Buffer.byteLength(doc.content, 'utf-8'),
  };

  const result = await writeDocument(
    { filePath: finalUrl, title, content: doc.content, contentHash: doc.metadata.contentHash, meta },
    embedder,
    store,
    onRelatedDocumentFound
  );

  return { ingested: true, skipped: false, title, chunkCount: result.chunkCount, merged: result.merged, mergedInto: result.mergedInto };
}
