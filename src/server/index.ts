// ─────────────────────────────────────────────────────────────────────────
// ENTRY POINT — WEB UI
// Dependency-free http.createServer (no Express) serving a single HTML page
// (page.ts) plus a small JSON API that's a thin wrapper around the same
// runIngestion/apiChat functions the CLI uses — one pipeline, two front-ends.
// Per-session chat history is kept in memory (`sessions` map, non-durable).
// ─────────────────────────────────────────────────────────────────────────
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import { createLocalEmbeddingProvider } from '../embeddings/local';
import { createSQLiteVectorStore } from '../vectorstore/sqlite';
import { resolveProvider } from '../llm';
import { apiChat } from '../query/engine';
import { runIngestion } from '../ingestion/engines/ingestionEngine';
import { ParserRegistry } from '../ingestion/parsers';
import { listNotes, createNote, deleteNote } from '../notes';
import { ConversationTurn } from '../types';
import { PAGE_HTML } from './page';

export interface ServeOptions {
  port: number;
  dbPath: string;
  capturesDir: string;
  topK: number;
}

export async function startServer(opts: ServeOptions): Promise<void> {
  const embedder = createLocalEmbeddingProvider();
  const store = createSQLiteVectorStore(opts.dbPath);
  const sessions = new Map<string, ConversationTurn[]>();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(PAGE_HTML);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/stats') {
        const stats = await store.getStats();
        sendJson(res, 200, { ...stats, dbPath: opts.dbPath });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/notes') {
        sendJson(res, 200, listNotes(opts.capturesDir));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/notes') {
        const body = await readJsonBody(req);
        const title = String(body.title ?? '').trim();
        const content = String(body.content ?? '').trim();
        if (!title || !content) { sendJson(res, 400, { error: 'title and content are required' }); return; }
        const fileName = await createNote(opts.dbPath, opts.capturesDir, title, content);
        sendJson(res, 200, { fileName });
        return;
      }

      if (req.method === 'DELETE' && url.pathname.startsWith('/api/notes/')) {
        const fileName = decodeURIComponent(url.pathname.slice('/api/notes/'.length));
        await deleteNote(opts.dbPath, opts.capturesDir, fileName);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/ingest') {
        const body = await readJsonBody(req);
        const inputPath = String(body.path ?? '').trim();
        if (!inputPath) { sendJson(res, 400, { error: 'path is required' }); return; }
        const absPath = path.resolve(inputPath);
        if (!fs.existsSync(absPath)) { sendJson(res, 400, { error: `path does not exist: ${absPath}` }); return; }
        const exts = String(body.extensions ?? '.txt,.md,.rtf').split(',').map((e: string) => e.trim());
        const registry = new ParserRegistry();
        const result = await runIngestion(absPath, registry, embedder, store, { extensions: exts });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/chat') {
        const body = await readJsonBody(req);
        const question = String(body.question ?? '').trim();
        const sessionId = String(body.sessionId ?? 'default');
        if (!question) { sendJson(res, 400, { error: 'question is required' }); return; }

        let provider;
        try {
          provider = await resolveProvider({ interactive: false });
        } catch (err) {
          sendJson(res, 500, { error: (err as Error).message });
          return;
        }

        const history = sessions.get(sessionId) ?? [];
        const result = await apiChat(question, embedder, store, provider.provider, history, opts.topK);
        sessions.set(sessionId, result.updatedHistory);
        sendJson(res, 200, {
          answer: result.answer ?? 'No relevant information found in the knowledge base.',
          sources: result.sources,
          usage: result.usage,
          provider: provider.name,
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/reset') {
        const body = await readJsonBody(req);
        const sessionId = String(body.sessionId ?? 'default');
        sessions.delete(sessionId);
        sendJson(res, 200, { ok: true });
        return;
      }

      sendJson(res, 404, { error: 'not found' });
    } catch (err) {
      sendJson(res, 500, { error: (err as Error).message });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, resolve);
  });
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 5_000_000) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) { resolve({}); return; }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}
