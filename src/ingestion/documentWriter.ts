// ─────────────────────────────────────────────────────────────────────────
// INGESTION PIPELINE — SHARED STORAGE TAIL
// Common chunk → embed → store logic used by all three ingestion engines
// (file, URL, image). Handles the related-document merge decision: if the
// caller detects (and confirms) that this content belongs with an existing
// document, new chunks are appended to that document's id instead of a new
// one — so e.g. a ticket file and a later screenshot of the same ticket
// become one grouped source instead of two fragmented ones.
//
// A tracking row is always (re)written at the source's own filePath/hash
// first, even when merging — that's what makes re-running ingestion on an
// unchanged source a free no-op instead of re-prompting every time.
// ─────────────────────────────────────────────────────────────────────────
import { EmbeddingProvider, FileMetadata, VectorStore, DocumentRef } from '../types';
import { chunkDocument } from './chunker';
import { findRelatedDocument } from './relatedDocument';

export interface WriteDocumentParams {
  filePath: string;
  title: string;
  content: string;
  contentHash: string;
  meta: FileMetadata;
}

export interface WriteDocumentResult {
  merged: boolean;
  mergedInto?: string;
  chunkCount: number;
}

export async function writeDocument(
  params: WriteDocumentParams,
  embedder: EmbeddingProvider,
  store: VectorStore,
  onRelatedDocumentFound?: (match: DocumentRef) => Promise<boolean>
): Promise<WriteDocumentResult> {
  const { filePath, title, content, contentHash, meta } = params;

  const related = onRelatedDocumentFound
    ? await findRelatedDocument(title, filePath, store)
    : null;
  const shouldMerge = related ? await onRelatedDocumentFound!(related) : false;

  await store.deleteDocument(filePath);
  const trackingId = await store.addDocument(filePath, contentHash, meta);

  const targetId = shouldMerge && related ? related.id : trackingId;
  const chunkOffset = shouldMerge && related ? await store.getChunkCount(targetId) : 0;

  const chunks = chunkDocument(content, targetId);
  for (const chunk of chunks) {
    const textToEmbed = `Source: ${title}\n${chunk.content}`;
    const embedding = await embedder.embed(textToEmbed);
    await store.addChunk(targetId, chunk.content, embedding, chunkOffset + chunk.chunkIndex);
  }

  return {
    merged: shouldMerge,
    mergedInto: shouldMerge ? related?.filePath : undefined,
    chunkCount: chunks.length,
  };
}
