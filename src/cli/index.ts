#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import { createLocalEmbeddingProvider } from '../embeddings/local';
import { createSQLiteVectorStore } from '../vectorstore/sqlite';
import { ParserRegistry } from '../ingestion/parsers';
import { runIngestion } from '../ingestion/ingestionEngine';
import { askQuestion } from '../query/engine';

const DB_PATH = path.join(process.cwd(), '.mykb', 'index.db');

function requireAnthropicKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is not set.');
    process.exit(1);
  }
  return key;
}

function requireDb(): void {
  if (!fs.existsSync(DB_PATH)) {
    console.error('No knowledge base found. Run `mykb ingest <path>` first.');
    process.exit(1);
  }
}

const program = new Command();

program
  .name('mykb')
  .description('Local RAG knowledge base CLI')
  .version('0.1.0');

// ── ingest ──────────────────────────────────────────────────────────────────

program
  .command('ingest <path>')
  .description('Ingest files from a directory into the knowledge base')
  .option(
    '-e, --extensions <exts>',
    'Comma-separated file extensions to include',
    '.txt,.md,.rtf'
  )
  .action(async (inputPath: string, options: { extensions: string }) => {
    const absPath = path.resolve(inputPath);

    if (!fs.existsSync(absPath)) {
      console.error(`Error: path does not exist: ${absPath}`);
      process.exit(1);
    }

    const extensions = options.extensions.split(',').map(e => e.trim());

    console.log(`Scanning : ${absPath}`);
    console.log(`Database : ${DB_PATH}\n`);

    const registry = new ParserRegistry();
    const embedder = createLocalEmbeddingProvider();
    const store = createSQLiteVectorStore(DB_PATH);

    const result = await runIngestion(absPath, registry, embedder, store, { extensions });

    console.log(`\nDone.`);
    console.log(`  Total   : ${result.total}`);
    console.log(`  Ingested: ${result.ingested}`);
    console.log(`  Skipped : ${result.skipped}`);
    console.log(`  Failed  : ${result.failed}`);
  });

// ── ask ─────────────────────────────────────────────────────────────────────

program
  .command('ask <question>')
  .description('Ask a question against the knowledge base')
  .action(async (question: string) => {
    const apiKey = requireAnthropicKey();
    requireDb();

    const embedder = createLocalEmbeddingProvider();
    const store = createSQLiteVectorStore(DB_PATH);

    console.log(`Q: ${question}\n`);
    console.log('A:');
    await askQuestion(question, embedder, store, apiKey);
  });

// ── stats ────────────────────────────────────────────────────────────────────

program
  .command('stats')
  .description('Show knowledge base statistics')
  .action(async () => {
    requireDb();

    const store = createSQLiteVectorStore(DB_PATH);
    const stats = await store.getStats();

    console.log('Knowledge Base');
    console.log('==============');
    console.log(`Documents : ${stats.documentCount}`);
    console.log(`Chunks    : ${stats.chunkCount}`);
    console.log(`Database  : ${DB_PATH}`);
  });

program.parse();
