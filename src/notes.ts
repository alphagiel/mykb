// ─────────────────────────────────────────────────────────────────────────
// QUICK CAPTURE — a shortcut into the ingestion pipeline for one-off notes
// Bypasses scan/parse (there's no file to discover yet) but still runs
// normalize-equivalent hashing, embedding, and storage, so a captured note
// is immediately searchable exactly like an ingested file. Notes are saved
// as real .md files under captures/, so `edit-note`/`delete-note` and even
// re-ingestion all treat them like any other document.
// ─────────────────────────────────────────────────────────────────────────
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { createLocalEmbeddingProvider } from './embeddings/local';
import { createSQLiteVectorStore } from './vectorstore/sqlite';

export interface NoteSummary {
  fileName: string;
  title: string;
  modifiedAt: Date;
}

export function listNotes(capturesDir: string): NoteSummary[] {
  if (!fs.existsSync(capturesDir)) return [];
  return fs
    .readdirSync(capturesDir)
    .filter(f => f.endsWith('.md'))
    .sort()
    .map(f => {
      const filePath = path.join(capturesDir, f);
      const firstLine = fs.readFileSync(filePath, 'utf-8').split('\n')[0];
      const title = firstLine.startsWith('#') ? firstLine.replace(/^#+\s*/, '') : f;
      return { fileName: f, title, modifiedAt: fs.statSync(filePath).mtime };
    });
}

export async function createNote(
  dbPath: string,
  capturesDir: string,
  title: string,
  content: string
): Promise<string> {
  fs.mkdirSync(capturesDir, { recursive: true });

  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName = `${slug}-${ts}.md`;
  const filePath = path.join(capturesDir, fileName);
  const fileContent = `# ${title}\n\n${content}\n`;

  fs.writeFileSync(filePath, fileContent, 'utf-8');

  const contentHash = createHash('sha256').update(fileContent).digest('hex');
  const embedder = createLocalEmbeddingProvider();
  const store = createSQLiteVectorStore(dbPath);

  const stat = fs.statSync(filePath);
  const docId = await store.addDocument(filePath, contentHash, {
    createdAt:  stat.birthtime,
    modifiedAt: stat.mtime,
    sizeBytes:  stat.size,
  });
  const embedding = await embedder.embed(`Source: ${slug}\n${title}\n${content}`);
  await store.addChunk(docId, fileContent.trim(), embedding, 0);

  return fileName;
}

export async function deleteNote(dbPath: string, capturesDir: string, fileName: string): Promise<void> {
  const safeName = path.basename(fileName);
  const filePath = path.join(capturesDir, safeName);
  if (!fs.existsSync(filePath)) throw new Error('Note not found');

  fs.unlinkSync(filePath);
  const store = createSQLiteVectorStore(dbPath);
  await store.deleteDocument(filePath);
}
