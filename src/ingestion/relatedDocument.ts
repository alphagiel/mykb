// ─────────────────────────────────────────────────────────────────────────
// RELATED-DOCUMENT DETECTION
// Prevents the same ticket/topic fragmenting across multiple KB documents
// (e.g. a NN-2988.rtf export and a later NN-2988 screenshot ending up as two
// unlinked sources). Extracts a ticket-ID-like token from the new document's
// title and looks for an existing document whose path already contains it.
// ─────────────────────────────────────────────────────────────────────────
import * as path from 'path';
import { VectorStore, DocumentRef } from '../types';

const TICKET_ID_PATTERN = /\b[A-Z]{2,}-\d+\b/;

export function extractTicketId(text: string): string | null {
  const match = text.match(TICKET_ID_PATTERN);
  return match ? match[0] : null;
}

export async function findRelatedDocument(
  title: string,
  currentFilePath: string,
  store: VectorStore
): Promise<DocumentRef | null> {
  const ticketId = extractTicketId(title);
  if (!ticketId) return null;

  const candidates = await store.findDocumentsByPathPattern(`%${ticketId}%`);
  const absCurrent = path.resolve(currentFilePath);

  for (const candidate of candidates) {
    if (path.resolve(candidate.filePath) === absCurrent) continue;
    const chunkCount = await store.getChunkCount(candidate.id);
    if (chunkCount > 0) return candidate;
  }
  return null;
}
