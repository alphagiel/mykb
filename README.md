# myworkjournal

A searchable work journal powered by local RAG (Retrieval Augmented Generation).

Point it at your tickets, notes, or exports and ask natural language questions over your own work history — instantly surface what you built, why you built it, and what broke along the way.

```bash
# Capture a quick note — prompts for title + content, indexed immediately
mywj note

# Ask anything across all your notes and ingested files
mywj ask "What auth issues did we have in Q1?"
mywj ask "When did we first run into the memory leak problem?"
mywj ask "What was the fix for NN-2725?"

# Edit or delete a note
mywj edit-note
mywj delete-note

# Ingest a folder of existing notes/exports
mywj ingest ./path/to/notes

# Interactive chat with conversation history
mywj chat
```

> **Tip:** Press `Esc` at any time during answer generation to cancel the stream immediately.

As you keep adding tickets over time, the value compounds. A year from now you'll have a fully queryable record of everything you've worked on.

Technically: ingests `.txt`, `.md`, and `.rtf` files into a local SQLite vector store, retrieves the most relevant chunks via cosine similarity, and streams the answer from your LLM of choice (Claude, OpenAI, or Ollama).

## Requirements

- Node.js 18+
- [Ollama](https://ollama.com) — default LLM, runs fully on your machine, zero cost, no API key

Embeddings also run locally via `@xenova/transformers` — so out of the box, **nothing leaves your machine and nothing costs money.**

---

## One-time setup

```bash
npm install -g myworkjournal
```

Pull the default model:

```bash
ollama pull llama3.1:8b
```

That's it. No API keys, no accounts, no billing.

---

## Why Ollama by default?

Most tools like this require an API key and charge per query. We default to [Ollama](https://ollama.com) so you can run everything locally for free. `llama3.1:8b` is the default model — it strikes the best balance between quality and speed for RAG workloads on a typical developer machine (good at reading context, following instructions, and citing sources).

You can override the model by setting `OLLAMA_MODEL` in your `.env`:

```
OLLAMA_MODEL=qwen2.5:7b    # stronger at Q&A
OLLAMA_MODEL=llama3.1:70b  # best quality, needs a powerful machine
OLLAMA_MODEL=llama3.2:3b   # fastest, lowest memory usage
```

---

## Using Claude or OpenAI instead

If you want higher quality answers and don't mind API costs, set a key in `.env` and it's picked up automatically:

```
# Claude (Anthropic) — best overall quality
ANTHROPIC_API_KEY=sk-ant-...

# OpenAI
OPENAI_API_KEY=sk-...
```

Priority order: **Anthropic → OpenAI → Ollama (default)**. Ollama is always the fallback if no API key is set.

---

## Usage

### Ingest files

```bash
mywj ingest ./path/to/your/notes
```

- Recursively scans for `.txt`, `.md`, and `.rtf` files
- Downloads the embedding model on first run (~25 MB, cached after that)
- Re-running is safe — unchanged files are skipped automatically
- The knowledge base is stored at `.myworkjournal/index.db` in the current directory

Restrict to specific extensions:

```bash
mywj ingest ./notes --extensions .txt,.md
```

---

### Ask a question

```bash
mywj ask "What was the root cause of NN-2725?"
```

Finds the most relevant chunks via cosine similarity and streams the answer in real time.

---

### Check what's indexed

```bash
mywj stats
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
mywj ingest "C:\path\to\jira-exports"

# 2. Ask anything
mywj ask "Which tickets are related to the auth service?"
mywj ask "What fix was deployed in version 2.4.1?"
mywj ask "Summarise all memory leak issues"

# 3. Add more files any time — re-ingest is incremental
mywj ingest "C:\path\to\more-notes"
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
    └── engine.ts              top-k retrieval + LLM synthesis (streaming)
```

---

## Database

The knowledge base is stored locally at:

```
<current-working-directory>/.myworkjournal/index.db
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
- **Per-project database** — the `.myworkjournal/` folder lives next to your knowledge files, not in a global location.
- **Fully local embeddings** — no API key or internet connection needed for ingestion after the model is cached.

---

## Roadmap

| Phase | Features |
|-------|----------|
| 1 ✅ | `.txt`, `.md`, `.rtf` — local embeddings — SQLite — hybrid FTS + semantic search — Claude streaming synthesis |
| 2 ✅ | Quick capture (`mywj note`) — edit + delete notes — Esc to cancel — interactive chat |
| 3 | PDF parser — git log ingestion (`mywj ingest-git`) — URL ingestion (`mywj ingest-url <url>`) |
