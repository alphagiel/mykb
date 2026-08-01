// ─────────────────────────────────────────────────────────────────────────
// IMAGE INGESTION PIPELINE — ORCHESTRATOR
// Mirrors ingestionEngine.ts but for a screenshot/image instead of a folder
// scan: transcribe → normalize → dedup (image hash) → chunk → embed → store
// Dedup hashes the raw image bytes (not the transcribed text) so re-running
// on an unchanged screenshot skips the paid vision-LLM call entirely.
// ─────────────────────────────────────────────────────────────────────────
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { DocumentRef, EmbeddingProvider, FileMetadata, LLMProvider, VectorStore } from '../../types';
import { normalize } from '../normalizer';
import { writeDocument } from '../documentWriter';

const MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export interface ImageIngestionResult {
  ingested: boolean;
  skipped: boolean;
  title?: string;
  chunkCount?: number;
  merged?: boolean;
  mergedInto?: string;
}

export async function runImageIngestion(
  imagePath: string,
  visionProvider: LLMProvider,
  embedder: EmbeddingProvider,
  store: VectorStore,
  titleOverride?: string,
  onRelatedDocumentFound?: (match: DocumentRef) => Promise<boolean>
): Promise<ImageIngestionResult> {
  const absPath = path.resolve(imagePath);
  const extension = path.extname(absPath).toLowerCase();
  const mediaType = MEDIA_TYPES[extension];
  if (!mediaType) {
    throw new Error(`Unsupported image type: ${extension} (supported: ${Object.keys(MEDIA_TYPES).join(', ')})`);
  }
  if (!fs.existsSync(absPath)) {
    throw new Error(`File not found: ${absPath}`);
  }
  if (!visionProvider.transcribeImage) {
    throw new Error('The selected LLM provider does not support image transcription.');
  }

  const imageBytes = fs.readFileSync(absPath);
  const imageHash = crypto.createHash('sha256').update(imageBytes).digest('hex');
  const title = titleOverride || path.basename(absPath, extension);

  if (await store.documentExists(absPath, imageHash)) {
    return { ingested: false, skipped: true, title };
  }

  process.stderr.write('Transcribing image via vision model (can take up to ~20s for large screenshots)...\n');
  const transcribedText = await visionProvider.transcribeImage(imageBytes.toString('base64'), mediaType);
  if (!transcribedText.trim()) {
    throw new Error(`No text could be transcribed from ${absPath}`);
  }

  const doc = normalize(transcribedText, absPath);

  const stat = fs.statSync(absPath);
  const meta: FileMetadata = {
    createdAt: stat.birthtime,
    modifiedAt: stat.mtime,
    sizeBytes: stat.size,
  };

  const result = await writeDocument(
    { filePath: absPath, title, content: doc.content, contentHash: imageHash, meta },
    embedder,
    store,
    onRelatedDocumentFound
  );

  return { ingested: true, skipped: false, title, chunkCount: result.chunkCount, merged: result.merged, mergedInto: result.mergedInto };
}
