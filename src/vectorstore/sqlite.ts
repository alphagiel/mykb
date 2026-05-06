import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { VectorStore, SearchResult } from '../types';

export function createSQLiteVectorStore(dbPath: string): VectorStore {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path   TEXT NOT NULL UNIQUE,
      content_hash TEXT NOT NULL,
      ingested_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
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

  return {
    async addDocument(filePath: string, contentHash: string): Promise<number> {
      const result = db
        .prepare(
          `INSERT INTO documents (file_path, content_hash)
           VALUES (?, ?)
           ON CONFLICT(file_path) DO UPDATE SET content_hash = excluded.content_hash,
                                                ingested_at  = strftime('%s', 'now')`
        )
        .run(filePath, contentHash);
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
          `SELECT c.content, c.embedding, c.chunk_index, d.file_path
           FROM chunks c
           JOIN documents d ON d.id = c.document_id`
        )
        .all() as Array<{
          content: string;
          embedding: string;
          chunk_index: number;
          file_path: string;
        }>;

      return rows
        .map(row => ({
          content: row.content,
          filePath: row.file_path,
          chunkIndex: row.chunk_index,
          similarity: cosineSimilarity(queryEmbedding, JSON.parse(row.embedding) as number[]),
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
