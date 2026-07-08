// ─────────────────────────────────────────────────────────────────────────
// INGESTION PIPELINE — STEP 3: NORMALIZE
// Cleans up whitespace/line-ending inconsistencies across source files and
// computes a sha256 content hash. That hash is what powers incremental
// re-ingestion: unchanged files are skipped without re-embedding them.
// ─────────────────────────────────────────────────────────────────────────
import * as crypto from 'crypto';
import * as path from 'path';
import { ParsedDocument } from '../types';

export function normalize(content: string, filePath: string): ParsedDocument {
  const normalized = content
    .replace(/\r\n/g, '\n')       // Windows line endings
    .replace(/\r/g, '\n')         // old Mac line endings
    .replace(/\t/g, ' ')          // tabs to spaces
    .replace(/[ ]{2,}/g, ' ')     // collapse multiple spaces
    .replace(/\n{3,}/g, '\n\n')   // collapse excessive blank lines
    .trim();

  const contentHash = crypto.createHash('sha256').update(normalized).digest('hex');

  return {
    content: normalized,
    metadata: {
      filePath,
      extension: path.extname(filePath).toLowerCase(),
      contentHash,
    },
  };
}
