import { EmbeddingProvider, VectorStore } from '../types';
import { ParserRegistry } from './parsers';
import { scan, ScanOptions } from './scanner';
import { normalize } from './normalizer';
import { chunkDocument } from './chunker';

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
  scanOptions: ScanOptions = {}
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

      // Remove stale version (if any) before re-inserting
      await store.deleteDocument(file.path);

      const documentId = await store.addDocument(file.path, doc.metadata.contentHash);
      const chunks = chunkDocument(doc.content, documentId);

      for (const chunk of chunks) {
        const embedding = await embedder.embed(chunk.content);
        await store.addChunk(documentId, chunk.content, embedding, chunk.chunkIndex);
      }

      process.stdout.write(`  [ok] ${file.path}\n`);
      result.ingested++;
    } catch (err) {
      process.stderr.write(`  [fail] ${file.path}: ${(err as Error).message}\n`);
      result.failed++;
    }
  }

  return result;
}
