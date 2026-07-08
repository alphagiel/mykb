#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// ENTRY POINT — CLI
// Wires user commands to the ingestion/query pipelines. Two modes:
//   - argv present  → one-shot commander CLI (`mywj ask "..."`, `mywj ingest .`)
//   - no argv        → interactive REPL (`mywj` with no args) with its own
//                       lightweight command parser
// `serve` boots the local web UI (see server/index.ts) as an alternative
// front-end over the exact same pipeline code.
// ─────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import { Command } from 'commander';
import * as readline from 'readline';
import * as path from 'path';
import * as fs from 'fs';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { createLocalEmbeddingProvider } from '../embeddings/local';
import { createSQLiteVectorStore } from '../vectorstore/sqlite';
import { ParserRegistry } from '../ingestion/parsers';
import { runIngestion } from '../ingestion/ingestionEngine';
import { askQuestion, chatTurn } from '../query/engine';
import { resolveProvider } from '../llm';
import { ConversationTurn } from '../types';
import { listNotes, createNote, deleteNote } from '../notes';

const DEFAULT_DB_DIR = path.join(process.env.HOME ?? process.env.USERPROFILE ?? process.cwd(), '.myworkjournal');
const DB_PATH = process.env.MYWJ_DB_PATH ?? path.join(DEFAULT_DB_DIR, 'index.db');
const CAPTURES_DIR = path.join(path.dirname(DB_PATH), 'captures');

// Versions before 0.4.0 stored the database at ./.myworkjournal relative to cwd.
// Detect that layout so upgraders get pointed at their old data instead of
// silently landing on an empty database at the new global path.
const LEGACY_DB_PATH = path.join(process.cwd(), '.myworkjournal', 'index.db');

function warnIfLegacyDbFound(): void {
  if (process.env.MYWJ_DB_PATH) return; // explicit override — not an upgrader
  if (fs.existsSync(DB_PATH)) return;    // already migrated / already using the new path
  if (!fs.existsSync(LEGACY_DB_PATH)) return;

  console.error(
    `Found an existing knowledge base at the old location:\n` +
    `  ${LEGACY_DB_PATH}\n` +
    `myworkjournal now stores its database at ${DB_PATH} by default.\n\n` +
    `To migrate:\n` +
    `  mkdir -p ${DEFAULT_DB_DIR}\n` +
    `  mv ${LEGACY_DB_PATH} ${DB_PATH}\n` +
    `  mv ${path.join(process.cwd(), '.myworkjournal', 'captures')} ${CAPTURES_DIR}  # if you have notes\n\n` +
    `Or set MYWJ_DB_PATH=${LEGACY_DB_PATH} to keep using the old location.\n`
  );
}

function dbExists(): boolean {
  warnIfLegacyDbFound();
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

  warnIfLegacyDbFound();

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

async function handleNoteInteractive(rl: readline.Interface): Promise<void> {
  if (!dbExists()) return;

  const title = await new Promise<string>(resolve =>
    rl.question('Title: ', line => resolve(line.trim()))
  );
  if (!title) { console.log('Cancelled.'); return; }

  console.log('Note (type or paste, Enter when done):');
  const lines: string[] = [];
  await new Promise<void>(resolve => {
    let timer: NodeJS.Timeout | null = null;
    const onLine = (line: string) => {
      lines.push(line);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        rl.removeListener('line', onLine);
        rl.pause();
        resolve();
      }, 50);
    };
    rl.on('line', onLine);
    rl.resume();
  });

  const content = lines.join('\n').trim();
  if (!content) { console.log('Cancelled.'); return; }

  const fileName = await createNote(DB_PATH, CAPTURES_DIR, title, content);
  console.log(`Captured: ${fileName}`);
}

async function handleEditNote(rl: readline.Interface): Promise<void> {
  if (!dbExists()) return;

  const notes = listNotes(CAPTURES_DIR);
  if (notes.length === 0) { console.log('No notes found.'); return; }

  notes.forEach((n, i) => console.log(`  ${i + 1}. ${n.title}`));
  console.log();

  const pick = await new Promise<string>(resolve =>
    rl.question('Pick a number to edit (or Enter to cancel): ', line => resolve(line.trim()))
  );

  const idx = parseInt(pick, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= notes.length) { console.log('Cancelled.'); return; }

  const note = notes[idx];
  const filePath = path.join(CAPTURES_DIR, note.fileName);
  const before = fs.readFileSync(filePath, 'utf-8');
  const editor = process.env.EDITOR ?? process.env.VISUAL ?? 'vi';

  // Pause readline so the editor can take over stdin/stdout
  rl.pause();
  spawnSync(editor, [filePath], { stdio: 'inherit' });
  rl.resume();

  const after = fs.readFileSync(filePath, 'utf-8');
  if (after === before) { console.log('No changes.'); return; }

  const contentHash = createHash('sha256').update(after).digest('hex');
  const embedder = createLocalEmbeddingProvider();
  const store = createSQLiteVectorStore(DB_PATH);

  // Remove old chunks, re-add with updated content
  await store.deleteDocument(filePath);
  const stat = fs.statSync(filePath);
  const docId = await store.addDocument(filePath, contentHash, {
    createdAt:  stat.birthtime,
    modifiedAt: stat.mtime,
    sizeBytes:  stat.size,
  });
  const slug = path.basename(filePath, '.md');
  const embedding = await embedder.embed(`Source: ${slug}\n${after}`);
  await store.addChunk(docId, after.trim(), embedding, 0);

  console.log('Saved and re-indexed.');
}

async function handleDeleteNote(rl: readline.Interface): Promise<void> {
  if (!dbExists()) return;

  const notes = listNotes(CAPTURES_DIR);
  if (notes.length === 0) { console.log('No notes found.'); return; }

  notes.forEach((n, i) => console.log(`  ${i + 1}. ${n.title}`));
  console.log();

  const pick = await new Promise<string>(resolve =>
    rl.question('Pick a number to delete (or Enter to cancel): ', line => resolve(line.trim()))
  );

  const idx = parseInt(pick, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= notes.length) { console.log('Cancelled.'); return; }

  const note = notes[idx];
  const confirmed = await new Promise<boolean>(resolve =>
    rl.question(`Delete "${note.title}"? [y/N] `, line => resolve(line.trim().toLowerCase() === 'y'))
  );
  if (!confirmed) { console.log('Cancelled.'); return; }

  await deleteNote(DB_PATH, CAPTURES_DIR, note.fileName);
  console.log('Deleted.');
}


function handleLLMError(err: unknown): void {
  const msg = (err as Error).message ?? '';
  if (msg.includes('Could not connect to Ollama')) {
    console.error('\nOllama is not running. Start it with:\n\n  ollama serve\n\nThen try again, or pick a different provider.');
  } else {
    console.error('\nError:', msg);
  }
}

function watchForEsc(controller: AbortController, alreadyRaw: boolean): () => void {
  if (!process.stdin.isTTY) return () => {};

  readline.emitKeypressEvents(process.stdin);
  if (!alreadyRaw) process.stdin.setRawMode(true);

  const onKeypress = (_str: unknown, key: { name?: string }) => {
    if (key?.name === 'escape') controller.abort();
  };

  process.stdin.on('keypress', onKeypress);

  return () => {
    process.stdin.removeListener('keypress', onKeypress);
    if (!alreadyRaw && process.stdin.isTTY) process.stdin.setRawMode(false);
  };
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
  console.log('A: (Esc to cancel)');

  const controller = new AbortController();
  const cancelEsc = watchForEsc(controller, false);
  let usage;
  try {
    usage = await askQuestion(question, embedder, store, provider.provider, topK, queryEmbedding, controller.signal);
  } catch (err) {
    handleLLMError(err);
    return;
  } finally {
    cancelEsc();
  }

  if (controller.signal.aborted) return;

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
  console.log('Type your question and press Enter. Paste multi-line content and it sends automatically. Type "exit" to quit.\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'you> ' });
  rl.prompt();

  let history: ConversationTurn[] = [];
  let totalIn = 0;
  let totalOut = 0;
  let lineBuffer: string[] = [];
  let processing = false;
  let sendTimer: NodeJS.Timeout | null = null;

  const processQuestion = async (question: string) => {
    const controller = new AbortController();
    const cancelEsc = watchForEsc(controller, true);
    try {
      console.log('\n' + '='.repeat(60));
      console.log('mywj  (Esc to cancel)');
      console.log('='.repeat(60));
      const { usage, updatedHistory } = await chatTurn(question, embedder, store, provider.provider, history, topK, controller.signal);
      history = updatedHistory;

      if (!controller.signal.aborted && usage) {
        totalIn += usage.inputTokens;
        totalOut += usage.outputTokens;
        const fmt = (n: number) => n.toLocaleString('en-US');
        console.log(`\nTokens  ${fmt(usage.inputTokens)} in · ${fmt(usage.outputTokens)} out  (session: ${fmt(totalIn)} in · ${fmt(totalOut)} out)`);
      }
      console.log('='.repeat(60) + '\n');
    } catch (err) {
      handleLLMError(err);
    } finally {
      cancelEsc();
    }
  };

  const scheduleSubmit = () => {
    if (sendTimer) clearTimeout(sendTimer);
    sendTimer = setTimeout(async () => {
      sendTimer = null;
      const question = lineBuffer.join('\n').trim();
      lineBuffer = [];
      if (!question) { rl.prompt(); return; }
      if (question === 'exit' || question === 'quit') { rl.close(); return; }
      processing = true;
      await processQuestion(question);
      processing = false;
      rl.prompt();
    }, 50);
  };

  rl.on('line', (line) => {
    if (processing) return;
    lineBuffer.push(line);
    scheduleSubmit();
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
  note                                Capture a note (prompts for title + content)
  edit note                           Edit a note in $EDITOR and re-index it
  delete note                         Delete a note (shows list to pick from)
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
        case 'note': {
          await handleNoteInteractive(rl);
          break;
        }
        case 'edit': {
          if (rest[0] === 'note') {
            await handleEditNote(rl);
          } else {
            console.log('Usage: edit note');
          }
          break;
        }
        case 'delete': {
          if (rest[0] === 'note') {
            await handleDeleteNote(rl);
          } else {
            console.log('Usage: delete note');
          }
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
  .command('note')
  .description('Capture a note interactively (prompts for title + content)')
  .action(async () => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await handleNoteInteractive(rl);
    rl.close();
    process.exit(0);
  });

program
  .command('edit-note')
  .description('Edit a note in $EDITOR and re-index it')
  .action(async () => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await handleEditNote(rl);
    rl.close();
    process.exit(0);
  });

program
  .command('delete-note')
  .description('Delete a note (shows list to pick from)')
  .action(async () => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await handleDeleteNote(rl);
    rl.close();
    process.exit(0);
  });


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

program
  .command('serve')
  .description('Start a local web UI for chatting with and managing the knowledge base')
  .option('-p, --port <n>', 'Port to listen on', '3131')
  .option('-k, --top-k <n>', 'Number of source chunks to retrieve per turn', '5')
  .action(async (options: { port: string; topK: string }) => {
    if (!dbExists()) return;
    const { startServer } = await import('../server');
    const port = parseInt(options.port, 10);
    try {
      await startServer({ port, dbPath: DB_PATH, capturesDir: CAPTURES_DIR, topK: parseInt(options.topK, 10) });
    } catch (err) {
      console.error('Failed to start server:', (err as Error).message);
      return;
    }
    console.log(`myworkjournal running at http://localhost:${port}`);
  });

if (process.argv.length <= 2) {
  runInteractive();
} else {
  program.parse();
}
