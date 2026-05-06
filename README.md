# mykb

A local RAG (Retrieval Augmented Generation) CLI tool. Ingest knowledge files into a per-project SQLite vector store and ask natural language questions over them using Claude.

## Requirements

- Node.js 18+
- An Anthropic API key — get one at [console.anthropic.com](https://console.anthropic.com)
- No other API keys — embeddings run locally via `@xenova/transformers`

---

## One-time setup

```bash
cd mykb

npm install       # install dependencies
npm run build     # compile TypeScript → dist/
```

Add your Anthropic API key to `.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

---

## Usage

### Ingest files

```bash
node dist/cli/index.js ingest ./path/to/your/notes
```

- Recursively scans for `.txt`, `.md`, and `.rtf` files
- Downloads the embedding model on first run (~25 MB, cached after that)
- Re-running is safe — unchanged files are skipped automatically
- The knowledge base is stored at `.mykb/index.db` in the current directory

Restrict to specific extensions:

```bash
node dist/cli/index.js ingest ./notes --extensions .txt,.md
```

---

### Ask a question

```bash
node dist/cli/index.js ask "What was the root cause of NN-2725?"
```

Finds the most relevant chunks via cosine similarity and streams the answer from Claude in real time.

---

### Check what's indexed

```bash
node dist/cli/index.js stats
```

---

### Development mode (no build step needed)

```bash
npm run dev -- ingest ./path/to/notes
npm run dev -- ask "Your question here"
npm run dev -- stats
```

---

## Typical workflow

```bash
# 1. Point it at your notes / exports / docs
node dist/cli/index.js ingest "C:\path\to\jira-exports"

# 2. Ask anything
node dist/cli/index.js ask "Which tickets are related to the auth service?"
node dist/cli/index.js ask "What fix was deployed in version 2.4.1?"
node dist/cli/index.js ask "Summarise all memory leak issues"

# 3. Add more files any time — re-ingest is incremental
node dist/cli/index.js ingest "C:\path\to\more-notes"
```

---

## Project structure

```
src/
├── cli/index.ts               commander entry point
├── types/index.ts             shared interfaces
├── ingestion/
│   ├── scanner.ts             recursive dir walk with extension filtering
│   ├── normalizer.ts          whitespace normalisation + sha256 content hash
│   ├── chunker.ts             sliding window chunker (~900 tokens, 100 overlap)
│   ├── ingestionEngine.ts     orchestrates scan → parse → normalise → chunk → embed → store
│   └── parsers/
│       ├── index.ts           ParserRegistry (strategy pattern)
│       ├── txt.ts
│       ├── markdown.ts
│       └── rtf.ts             inline RTF stripper (no extra dependency)
├── embeddings/
│   └── local.ts               local embeddings via @xenova/transformers (all-MiniLM-L6-v2)
├── vectorstore/
│   └── sqlite.ts              better-sqlite3 + cosine similarity in JS
└── query/
    └── engine.ts              top-k retrieval + Claude claude-opus-4-6 synthesis (streaming)
```

---

## Database

The knowledge base is stored locally at:

```
<current-working-directory>/.mykb/index.db
```

Schema:

| Table       | Columns                                                        |
|-------------|----------------------------------------------------------------|
| `documents` | `id`, `file_path`, `content_hash`, `ingested_at`              |
| `chunks`    | `id`, `document_id`, `content`, `embedding`, `chunk_index`    |

Chunks are deleted automatically when their parent document is removed (`ON DELETE CASCADE`).

---

## Design decisions

- **Hash-based dedup** — files are re-processed only when their content changes.
- **Pluggable abstractions** — `Parser`, `EmbeddingProvider`, and `VectorStore` are interfaces. Phase 2 additions (PDF/DOCX parsers, LanceDB) are drop-in implementations with no changes to ingestion or query logic.
- **No external vector DB** — cosine similarity runs in JS over SQLite rows. Suitable for thousands of chunks; swap to LanceDB when scale demands it.
- **Per-project database** — the `.mykb/` folder lives next to your knowledge files, not in a global location.
- **Fully local embeddings** — no API key or internet connection needed for ingestion after the model is cached.

---

## Roadmap

| Phase | Features |
|-------|----------|
| 1 (current) | `.txt`, `.md`, `.rtf` — local embeddings — SQLite — Claude streaming synthesis |
| 2 | PDF + DOCX parsers, metadata filtering by ticket ID |
| 3 | Hybrid search, LanceDB, config file, structured ticket extraction |
