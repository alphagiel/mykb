#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import * as readline from 'readline';
import * as path from 'path';
import * as fs from 'fs';
import { createLocalEmbeddingProvider } from '../embeddings/local';
import { createSQLiteVectorStore } from '../vectorstore/sqlite';
import { ParserRegistry } from '../ingestion/parsers';
import { runIngestion } from '../ingestion/ingestionEngine';
import { askQuestion } from '../query/engine';
import { resolveProvider } from '../llm';

const DB_PATH = path.join(process.cwd(), '.mykb', 'index.db');

function dbExists(): boolean {
  if (!fs.existsSync(DB_PATH)) {
    console.error('No knowledge base found. Run `ingest <path>` first.');
    return false;
  }
  return true;
}

// ── Shared command handlers ───────────────────────────────────────────────────

async function handleIngest(inputPath: string, extensions = '.txt,.md,.rtf'): Promise<void> {
  const absPath = path.resolve(inputPath);
  if (!fs.existsSync(absPath)) {
    console.error(`Error: path does not exist: ${absPath}`);
    return;
  }

  const exts = extensions.split(',').map(e => e.trim());
  console.log(`Scanning : ${absPath}`);
  console.log(`Database : ${DB_PATH}\n`);

  const registry = new ParserRegistry();
  const embedder = createLocalEmbeddingProvider();
  const store = createSQLiteVectorStore(DB_PATH);
  const result = await runIngestion(absPath, registry, embedder, store, { extensions: exts });

  console.log(`\nDone.`);
  console.log(`  Total   : ${result.total}`);
  console.log(`  Ingested: ${result.ingested}`);
  console.log(`  Skipped : ${result.skipped}`);
  console.log(`  Failed  : ${result.failed}`);
}

async function handleAsk(question: string): Promise<void> {
  if (!dbExists()) return;

  let provider: Awaited<ReturnType<typeof resolveProvider>>;
  try {
    provider = await resolveProvider();
  } catch (err) {
    console.error((err as Error).message);
    return;
  }

  console.log(`Provider : ${provider.name}`);

  const embedder = createLocalEmbeddingProvider();
  const store = createSQLiteVectorStore(DB_PATH);

  console.log(`\nQ: ${question}\n`);
  console.log('A:');
  await askQuestion(question, embedder, store, provider.provider);
  console.log();
}

async function handleStats(): Promise<void> {
  if (!dbExists()) return;
  const store = createSQLiteVectorStore(DB_PATH);
  const stats = await store.getStats();
  console.log('\nKnowledge Base');
  console.log('==============');
  console.log(`Documents : ${stats.documentCount}`);
  console.log(`Chunks    : ${stats.chunkCount}`);
  console.log(`Database  : ${DB_PATH}`);
  console.log();
}

// ── Interactive mode ──────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
  ingest <path> [-e .txt,.md,.rtf]   Ingest files from a directory into the knowledge base
  ask <question>                      Ask a question against the knowledge base
  stats                               Show knowledge base statistics
  help                                Show this help message
  exit                                Exit mykb
`);
}

function parseArgs(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (const ch of input) {
    if (inQuote) {
      if (ch === quoteChar) inQuote = false;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === ' ') {
      if (current) { args.push(current); current = ''; }
    } else {
      current += ch;
    }
  }
  if (current) args.push(current);
  return args;
}

async function runInteractive(): Promise<void> {
  console.log('mykb — local knowledge base');
  console.log('Type "help" for commands, "exit" to quit.\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'mykb> ',
  });

  rl.prompt();

  rl.on('line', async (line) => {
    rl.pause();
    const trimmed = line.trim();

    if (!trimmed) {
      rl.prompt();
      rl.resume();
      return;
    }

    if (trimmed === 'exit' || trimmed === 'quit') {
      rl.close();
      return;
    }

    const args = parseArgs(trimmed);
    const [cmd, ...rest] = args;

    try {
      switch (cmd) {
        case 'ingest': {
          const inputPath = rest[0];
          if (!inputPath) { console.error('Usage: ingest <path> [-e .txt,.md,.rtf]'); break; }
          const eFlag = rest.indexOf('-e');
          const extensions = eFlag !== -1 && rest[eFlag + 1] ? rest[eFlag + 1] : '.txt,.md,.rtf';
          await handleIngest(inputPath, extensions);
          break;
        }
        case 'ask': {
          const question = rest.join(' ');
          if (!question) { console.error('Usage: ask <question>'); break; }
          await handleAsk(question);
          break;
        }
        case 'stats':
          await handleStats();
          break;
        case 'help':
          printHelp();
          break;
        default:
          console.log(`Unknown command: "${cmd}". Type "help" for usage.`);
      }
    } catch (err) {
      console.error('Error:', (err as Error).message);
    }

    rl.prompt();
    rl.resume();
  });

  rl.on('close', () => {
    console.log('Bye.');
    process.exit(0);
  });
}

// ── One-shot CLI (with args) ──────────────────────────────────────────────────

const program = new Command();

program
  .name('mykb')
  .description('Local RAG knowledge base CLI')
  .version('0.1.0');

program
  .command('ingest <path>')
  .description('Ingest files from a directory into the knowledge base')
  .option('-e, --extensions <exts>', 'Comma-separated file extensions to include', '.txt,.md,.rtf')
  .action(async (inputPath: string, options: { extensions: string }) => {
    await handleIngest(inputPath, options.extensions);
  });

program
  .command('ask <question>')
  .description('Ask a question against the knowledge base')
  .action(async (question: string) => {
    await handleAsk(question);
  });

program
  .command('stats')
  .description('Show knowledge base statistics')
  .action(async () => {
    await handleStats();
  });

if (process.argv.length <= 2) {
  runInteractive();
} else {
  program.parse();
}
