// ─────────────────────────────────────────────────────────────────────────
// INGESTION PIPELINE — ORCHESTRATOR
// Wires together every ingestion step in order:
//   scan → parse → normalize → dedup (content hash) → chunk → embed → store
// This is the file `mywj ingest <path>` actually calls. Content-hash dedup
// means re-running ingestion on the same folder is cheap — only new or
// changed files get re-embedded.
// ─────────────────────────────────────────────────────────────────────────
import * as fs from 'fs';
import * as path from 'path';
import { DocumentRef, EmbeddingProvider, FileMetadata, VectorStore } from '../../types';
import { ParserRegistry } from '../parsers';
import { scan, ScanOptions } from '../scanner';
import { normalize } from '../normalizer';
import { writeDocument } from '../documentWriter';

export interface IngestionResult {
  total: number;
  ingested: number;
  skipped: number;
  failed: number;
}

export async function runIngestion(
  dirPath: string,
  registry: ParserRegistry,
  embedder: EmbeddingProvider,
  store: VectorStore,
  scanOptions: ScanOptions = {},
  onRelatedDocumentFound?: (match: DocumentRef, filePath: string) => Promise<boolean>
): Promise<IngestionResult> {
  const files = scan(dirPath, scanOptions);
  const result: IngestionResult = { total: files.length, ingested: 0, skipped: 0, failed: 0 };

  for (const file of files) {
    const parser = registry.getParser(file.extension);
    if (!parser) {
      result.skipped++;
      continue;
    }

    try {
      const rawText = await parser.parse(file.path);
      const doc = normalize(rawText, file.path);

      if (await store.documentExists(file.path, doc.metadata.contentHash)) {
        result.skipped++;
        continue;
      }

      const stat = fs.statSync(file.path);
      const meta: FileMetadata = {
        createdAt:  stat.birthtime,
        modifiedAt: stat.mtime,
        sizeBytes:  stat.size,
      };
      const basename = path.basename(file.path, path.extname(file.path));

      const written = await writeDocument(
        { filePath: file.path, title: basename, content: doc.content, contentHash: doc.metadata.contentHash, meta },
        embedder,
        store,
        onRelatedDocumentFound ? match => onRelatedDocumentFound(match, file.path) : undefined
      );

      process.stdout.write(
        written.merged
          ? `  [merged into ${path.basename(written.mergedInto!)}] ${file.path}\n`
          : `  [ok] ${file.path}\n`
      );
      result.ingested++;
    } catch (err) {
      process.stderr.write(`  [fail] ${file.path}: ${(err as Error).message}\n`);
      result.failed++;
    }
  }

  return result;
}
