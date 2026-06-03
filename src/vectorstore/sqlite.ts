import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { FileMetadata, VectorStore, SearchResult } from '../types';

export function createSQLiteVectorStore(dbPath: string): VectorStore {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path       TEXT NOT NULL UNIQUE,
      content_hash    TEXT NOT NULL,
      ingested_at     INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      file_created_at INTEGER,
      file_modified_at INTEGER,
      file_size_bytes INTEGER
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      content     TEXT NOT NULL,
      embedding   TEXT NOT NULL,
      chunk_index INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks(document_id);
  `);

  // Migrate existing DBs that predate file metadata columns
  const existingCols = (db.prepare('PRAGMA table_info(documents)').all() as { name: string }[]).map(r => r.name);
  if (!existingCols.includes('file_created_at'))  db.exec('ALTER TABLE documents ADD COLUMN file_created_at INTEGER');
  if (!existingCols.includes('file_modified_at')) db.exec('ALTER TABLE documents ADD COLUMN file_modified_at INTEGER');
  if (!existingCols.includes('file_size_bytes'))  db.exec('ALTER TABLE documents ADD COLUMN file_size_bytes INTEGER');

  // Backfill metadata for docs ingested before this feature
  const backfill = db.prepare(
    `UPDATE documents SET file_created_at = ?, file_modified_at = ?, file_size_bytes = ? WHERE file_path = ?`
  );
  const docsWithoutMeta = db
    .prepare('SELECT file_path FROM documents WHERE file_created_at IS NULL')
    .all() as { file_path: string }[];
  for (const { file_path } of docsWithoutMeta) {
    try {
      const stat = fs.statSync(file_path);
      backfill.run(
        Math.floor(stat.birthtime.getTime() / 1000),
        Math.floor(stat.mtime.getTime()     / 1000),
        stat.size,
        file_path,
      );
    } catch {
      // file may have moved — leave nulls, not a fatal error
    }
  }

  return {
    async addDocument(filePath: string, contentHash: string, meta?: FileMetadata): Promise<number> {
      const createdAt  = meta ? Math.floor(meta.createdAt.getTime()  / 1000) : null;
      const modifiedAt = meta ? Math.floor(meta.modifiedAt.getTime() / 1000) : null;
      const sizeBytes  = meta ? meta.sizeBytes : null;
      const result = db
        .prepare(
          `INSERT INTO documents (file_path, content_hash, file_created_at, file_modified_at, file_size_bytes)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(file_path) DO UPDATE SET content_hash     = excluded.content_hash,
                                                ingested_at      = strftime('%s', 'now'),
                                                file_created_at  = excluded.file_created_at,
                                                file_modified_at = excluded.file_modified_at,
                                                file_size_bytes  = excluded.file_size_bytes`
        )
        .run(filePath, contentHash, createdAt, modifiedAt, sizeBytes);
      return result.lastInsertRowid as number;
    },

    async documentExists(filePath: string, contentHash: string): Promise<boolean> {
      const row = db
        .prepare('SELECT id FROM documents WHERE file_path = ? AND content_hash = ?')
        .get(filePath, contentHash) as { id: number } | undefined;
      return row !== undefined;
    },

    async addChunk(
      documentId: number,
      content: string,
      embedding: number[],
      chunkIndex: number
    ): Promise<void> {
      db.prepare(
        `INSERT INTO chunks (document_id, content, embedding, chunk_index)
         VALUES (?, ?, ?, ?)`
      ).run(documentId, content, JSON.stringify(embedding), chunkIndex);
    },

    async deleteDocument(filePath: string): Promise<void> {
      // Chunks cascade via FK
      db.prepare('DELETE FROM documents WHERE file_path = ?').run(filePath);
    },

    async similaritySearch(queryEmbedding: number[], k: number): Promise<SearchResult[]> {
      const rows = db
        .prepare(
          `SELECT c.content, c.embedding, c.chunk_index, d.file_path, d.file_created_at, d.file_modified_at
           FROM chunks c
           JOIN documents d ON d.id = c.document_id`
        )
        .all() as Array<{
          content: string;
          embedding: string;
          chunk_index: number;
          file_path: string;
          file_created_at: number | null;
          file_modified_at: number | null;
        }>;

      return rows
        .map(row => ({
          content: row.content,
          filePath: row.file_path,
          chunkIndex: row.chunk_index,
          similarity: cosineSimilarity(queryEmbedding, JSON.parse(row.embedding) as number[]),
          fileCreatedAt:  row.file_created_at  ? new Date(row.file_created_at  * 1000) : undefined,
          fileModifiedAt: row.file_modified_at ? new Date(row.file_modified_at * 1000) : undefined,
        }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, k);
    },

    async getStats(): Promise<{ documentCount: number; chunkCount: number }> {
      const { count: documentCount } = db
        .prepare('SELECT COUNT(*) as count FROM documents')
        .get() as { count: number };
      const { count: chunkCount } = db
        .prepare('SELECT COUNT(*) as count FROM chunks')
        .get() as { count: number };
      return { documentCount, chunkCount };
    },
  };
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
