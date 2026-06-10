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
import { askQuestion, chatTurn } from '../query/engine';
import { resolveProvider } from '../llm';
import { ConversationTurn } from '../types';

const DB_PATH = path.join(process.cwd(), '.myworkjournal', 'index.db');

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

async function handleAsk(question: string, topK = 5): Promise<void> {
  if (!dbExists()) return;

  let provider: Awaited<ReturnType<typeof resolveProvider>>;
  try {
    provider = await resolveProvider();
  } catch (err) {
    console.error((err as Error).message);
    return;
  }

  const embedder = createLocalEmbeddingProvider();
  const store = createSQLiteVectorStore(DB_PATH);

  // Embed before printing so model-load logs don't interrupt the output
  const queryEmbedding = await embedder.embed(question);

  console.log(`Provider : ${provider.name}`);
  console.log(`Sources  : ${topK} chunks (higher = more context, more tokens)`);
  console.log(`\nQ: ${question}\n`);
  console.log('A:');
  const usage = await askQuestion(question, embedder, store, provider.provider, topK, queryEmbedding);

  console.log();
  console.log('─'.repeat(50));
  console.log(`Embeddings  all-MiniLM-L6-v2 (local)`);
  console.log(`LLM         ${provider.name}`);
  if (usage) {
    const fmt = (n: number) => n.toLocaleString('en-US');
    console.log(`Tokens      ${fmt(usage.inputTokens)} in · ${fmt(usage.outputTokens)} out`);
  }
  console.log(`Tip         use -k <n> to retrieve more context (current: ${topK})`);
  console.log('─'.repeat(50));
}

async function handleChat(topK = 5): Promise<void> {
  if (!dbExists()) return;

  let provider: Awaited<ReturnType<typeof resolveProvider>>;
  try {
    provider = await resolveProvider();
  } catch (err) {
    console.error((err as Error).message);
    return;
  }

  const embedder = createLocalEmbeddingProvider();
  const store = createSQLiteVectorStore(DB_PATH);

  console.log(`Provider : ${provider.name}`);
  console.log(`Sources  : ${topK} chunks per turn  (-k <n> to change)`);
  console.log('Type or paste your input. Press Enter on an empty line when done. Type "exit" to quit.\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'you> ' });
  rl.prompt();

  let history: ConversationTurn[] = [];
  let totalIn = 0;
  let totalOut = 0;
  let lineBuffer: string[] = [];
  let awaitingConfirm = false;

  const confirm = (question: string): Promise<boolean> =>
    new Promise(resolve => rl.question('Submit? [Y/n] ', ans => resolve(ans.trim().toLowerCase() !== 'n')));

  const processQuestion = async (question: string) => {
    console.log('\n' + '='.repeat(60));
    console.log('mywj');
    console.log('='.repeat(60));
    const { usage, updatedHistory } = await chatTurn(question, embedder, store, provider.provider, history, topK);
    history = updatedHistory;

    if (usage) {
      totalIn += usage.inputTokens;
      totalOut += usage.outputTokens;
      const fmt = (n: number) => n.toLocaleString('en-US');
      console.log(`\nTokens  ${fmt(usage.inputTokens)} in · ${fmt(usage.outputTokens)} out  (session: ${fmt(totalIn)} in · ${fmt(totalOut)} out)`);
    }
    console.log('='.repeat(60) + '\n');
  };

  rl.on('line', async (line) => {
    if (awaitingConfirm) return;

    // Empty line = end of input
    if (line.trim() === '') {
      const question = lineBuffer.join('\n').trim();
      lineBuffer = [];

      if (!question) { rl.prompt(); return; }
      if (question === 'exit' || question === 'quit') { rl.close(); return; }

      awaitingConfirm = true;
      const ok = await confirm(question);
      awaitingConfirm = false;

      if (ok) {
        await processQuestion(question);
      } else {
        console.log('Discarded.\n');
      }
      rl.prompt();
      return;
    }

    lineBuffer.push(line);
    if (lineBuffer.length === 1) process.stdout.write('  (press Enter again to send)\n');
  });

  rl.on('close', () => {
    console.log('Bye.');
    process.exit(0);
  });
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
  ask <question> [-k N]               Ask a question (default -k 5; higher = more context, more tokens)
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
  console.log('myworkjournal — searchable work journal');
  console.log('Type "help" for commands, "exit" to quit.\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'mywj> ',
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
          const kFlag = rest.indexOf('-k');
          const topK = kFlag !== -1 && rest[kFlag + 1] ? parseInt(rest[kFlag + 1], 10) : 5;
          const question = rest.filter((_, i) => i !== kFlag && i !== kFlag + 1).join(' ');
          if (!question) { console.error('Usage: ask <question> [-k N]'); break; }
          await handleAsk(question, topK);
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
  .name('mywj')
  .description('A searchable work journal powered by local RAG')
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
  .option('-k, --top-k <n>', 'Number of source chunks to retrieve (more = richer context but higher token cost)', '5')
  .action(async (question: string, options: { topK: string }) => {
    await handleAsk(question, parseInt(options.topK, 10));
  });

program
  .command('chat')
  .description('Start an interactive chat session with conversation history')
  .option('-k, --top-k <n>', 'Number of source chunks to retrieve per turn', '5')
  .action(async (options: { topK: string }) => {
    await handleChat(parseInt(options.topK, 10));
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
