# myworkjournal

A searchable work journal powered by local RAG (Retrieval Augmented Generation).

Point it at your tickets, notes, or exports and ask natural language questions over your own work history — instantly surface what you built, why you built it, and what broke along the way.

## What's new

**0.5.1** — 🌐 URL ingestion: `mywj ingest-url <url>` pulls in web pages and Google Docs (not just local files), with automatic readable-content extraction and Google Docs export support.

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

# Ingest a web page or Google Doc
mywj ingest-url https://example.com/some-article

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

## How it works

RAG = **R**etrieval **A**ugmented **G**eneration: instead of asking an LLM to answer from memory (and possibly hallucinate), you first *retrieve* the most relevant pieces of your own data, then *generate* an answer grounded in exactly that data — with citations back to source files.

There are two independent pipelines. Ingestion happens once per file (and is skipped on unchanged files); query happens on every question.

### 1. Ingestion pipeline — turning files into searchable knowledge

```
 ┌──────────┐   ┌───────┐   ┌───────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐
 │  SCAN    │──▶│ PARSE │──▶│ NORMALIZE │──▶│  DEDUP  │──▶│  CHUNK  │──▶│  EMBED   │──▶ STORE
 │ scanner  │   │parsers│   │normalizer │   │(content │   │ chunker │   │embeddings│    (SQLite)
 │   .ts    │   │  /*   │   │   .ts     │   │  hash)  │   │   .ts   │   │/local.ts │
 └──────────┘   └───────┘   └───────────┘   └─────────┘   └─────────┘   └─────────┘
```

| Step | File | What happens |
| --- | --- | --- |
| **Scan** | [`ingestion/scanner.ts`](src/ingestion/scanner.ts) | Recursively walk a folder, filter to `.txt` / `.md` / `.rtf`, skip anything over 10MB.<br>e.g. 200 files in `notes/` → 187 `FileDescriptor{path,extension,sizeBytes}`, .pdf and one 14MB file dropped.<br>Think of it like going through a filing cabinet and only pulling out the folders you can actually read — anything too big or in a weird format gets left in the drawer. |
| **Parse** | [`ingestion/parsers/`](src/ingestion/parsers) | Extension-based strategy pattern — RTF gets stripped of control codes, txt/md are read as-is.<br>e.g. `meeting.rtf` (`{\rtf1\ansi ... \par Q3 budget \par}`) → raw string `"Q3 budget"`.<br>Think of it like this: you have a saved note in a `.rtf` file, and parsing it turns it from looking like `{\rtf1\ansi ... \par Q3 budget \par}` into plain text: `"Q3 budget"`. |
| **Normalize** | [`ingestion/normalizer.ts`](src/ingestion/normalizer.ts) | Clean up line endings/whitespace, compute a `sha256` hash of the content.<br>e.g. `"Q3  budget\r\n\r\n\r\ntargets"` → `{content:"Q3 budget\n\ntargets", contentHash:"a3f9e1..."}`.<br>Think of it like tidying a messy handwritten page — extra spaces and blank lines get smoothed out, then it gets a fingerprint so we can tell later if it ever changes. |
| **Dedup** | [`ingestion/engines/ingestionEngine.ts`](src/ingestion/engines/ingestionEngine.ts) | Compare hash against what's already stored — unchanged files are skipped, so re-ingestion is cheap and incremental.<br>e.g. `notes.md` hash matches the stored row → `documentExists()` returns true → file skipped.<br>Think of it like checking if you already photocopied this exact page before deciding to copy it again — same fingerprint, skip it. |
| **Chunk** | [`ingestion/chunker.ts`](src/ingestion/chunker.ts) | Slide a ~900-token window (100-token overlap) across the text so no chunk gets too big for the embedding model and no fact gets cut in half at a boundary.<br>e.g. a 2,400-token doc → 3 `Chunk` objects, each overlapping the previous one's last 100 tokens.<br>Think of it like tearing a long letter into overlapping pages so no sentence gets sliced in half between pages. |
| **Embed** | [`embeddings/local.ts`](src/embeddings/local.ts) | Each chunk → a 384-dim vector via `all-MiniLM-L6-v2`, running fully on-device.<br>e.g. `"Source: notes\nQ3 budget targets"` → `Float32Array` of 384 numbers.<br>Think of it like turning a sentence into a fingerprint made of numbers that captures its meaning, so similar sentences end up with similar-looking fingerprints. |
| **Store** | [`vectorstore/sqlite.ts`](src/vectorstore/sqlite.ts) | Persist to SQLite: `documents` (one row per file) + `chunks` (one row per chunk, embedding stored as JSON) + an FTS5 full-text index built alongside it.<br>e.g. chunk + embedding → row in `chunks` (embedding as JSON text) + mirrored row in `chunks_fts`.<br>Think of it like filing that fingerprint and the original text into two cabinets — one for quick meaning-based lookup, one for exact keyword search. |

### 2. URL ingestion pipeline — turning web pages into searchable knowledge

```
mywj ingest-url <url>
        │
        ▼
web/fetcher.fetchUrl(url)         → { html, finalUrl, contentType }
        │  (fetch w/ timeout, 5-redirect cap, 10MB size cap, content-type check)
        ▼
web/extractor.extract(html, url)  → { title, textContent }
        │  (jsdom → Readability().parse())
        ▼
normalize(textContent, url)       → { content, metadata: { filePath: url, contentHash } }
        │  (reused as-is — filePath field just holds the URL string)
        ▼
store.documentExists(url, hash)?  → skip if unchanged (dedup reused as-is)
        │
        ▼
chunkDocument + embed (Source: <title>) + store.addChunk   → same as file ingestion
```

| Step | File | What happens |
| --- | --- | --- |
| **Fetch** | [`ingestion/web/fetcher.ts`](src/ingestion/web/fetcher.ts) | Fetches the URL with a timeout, a 5-redirect cap, and a 10MB size cap; rejects non-HTML responses.<br>e.g. a `301` to a new location gets followed once automatically; a PDF link is rejected with a clear error instead of being mis-parsed as text. |
| **Extract** | [`ingestion/web/extractor.ts`](src/ingestion/web/extractor.ts) | Parses the HTML with `jsdom` and runs Mozilla's `Readability` over it — the same algorithm behind Firefox Reader Mode — to pull out the article title and body, stripping nav bars, ads, and boilerplate.<br>e.g. a blog post page with a sidebar and comments section → just the article title + body text. |
| **Normalize → Store** | [`ingestion/engines/urlIngestionEngine.ts`](src/ingestion/engines/urlIngestionEngine.ts) | Reuses `normalizer.ts`, `chunker.ts`, and `VectorStore` unchanged — the URL itself plays the role a file path plays in the file pipeline, so re-running `ingest-url` on an unchanged page is skipped for free via the same content-hash dedup. |

No changes were needed to `VectorStore`, `chunker.ts`, or `normalize()` to support this — `ParserRegistry`/`scan()` are bypassed entirely since there's no local file to walk; `runUrlIngestion` lives in `engines/` alongside the file-ingestion orchestrator, not as a new `Parser` implementation.

### 3. Query pipeline — hybrid search + grounded generation

```
                       ┌──────────────────────┐
   question ──────────▶│  rewriteQuery()      │  (chat only — rewrites vague
                       │  query/rewriter.ts   │   follow-ups into standalone Qs)
                       └──────────┬───────────┘
                                  ▼
                       ┌──────────────────────┐
                       │   hybridSearch()      │
                       │   query/engine.ts     │
                       └──────────┬───────────┘
                     ┌────────────┴────────────┐
                     ▼                         ▼
          ┌─────────────────────┐   ┌─────────────────────┐
          │  Semantic search    │   │  Keyword search      │
          │  cosine similarity  │   │  SQLite FTS5          │
          │  over embeddings    │   │  (exact terms, IDs)   │
          └──────────┬──────────┘   └──────────┬───────────┘
                     └────────────┬────────────┘
                                  ▼
                       dedupe + merge → top-K chunks
                                  ▼
                       ┌──────────────────────┐
                       │  Build numbered       │   [1] File: ... \n content
                       │  context block        │   [2] File: ... \n content
                       └──────────┬───────────┘
                                  ▼
                       ┌──────────────────────┐
                       │  LLMProvider.answer() │  Claude / OpenAI / Ollama
                       │  llm/*.ts             │  streams tokens, cites [1][2]
                       └──────────┬───────────┘
                                  ▼
                         answer + source list
```

**Why hybrid search?** Semantic (embedding) search is great at "what's conceptually related" but can miss exact strings — a ticket ID like `NN-2725` or an error code. Keyword search (SQLite FTS5) nails exact terms but misses paraphrasing. Running both and merging the results (deduped by file + chunk) gets the best of each — see [`hybridSearch()` in `query/engine.ts`](src/query/engine.ts).

**Why it's grounded, not hallucinated:** the LLM is only ever shown the retrieved chunks (never the whole knowledge base) and is instructed to answer *only* from that context, citing chunk numbers inline. If nothing relevant is retrieved, it says so instead of making something up.

**Pluggability:** `Parser`, `EmbeddingProvider`, `VectorStore`, and `LLMProvider` are all interfaces ([`types/index.ts`](src/types/index.ts)). The pipeline orchestrators (`ingestionEngine.ts`, `query/engine.ts`) only depend on those interfaces — swapping SQLite for LanceDB, or Ollama for Claude, never touches pipeline logic.

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

### Ingest a web page

```bash
mywj ingest-url https://example.com/some-article
```

- Extracts the readable article body (via `jsdom` + `@mozilla/readability`), stripping nav/ads/boilerplate
- Follows redirects (up to 5), rejects non-HTML responses and responses over 10MB
- Re-running on the same URL is safe — unchanged pages are skipped automatically, same as file ingestion

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
│   ├── engines/
│   │   ├── ingestionEngine.ts     orchestrates scan → parse → normalise → chunk → embed → store
│   │   └── urlIngestionEngine.ts  orchestrates fetch → extract → normalise → chunk → embed → store
│   ├── parsers/
│   │   ├── index.ts           ParserRegistry (strategy pattern)
│   │   ├── txt.ts
│   │   ├── markdown.ts
│   │   └── rtf.ts             inline RTF stripper (no extra dependency)
│   └── web/
│       ├── fetcher.ts         fetch w/ timeout, redirect + size caps, content-type check
│       └── extractor.ts       jsdom + @mozilla/readability article extraction
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
~/.myworkjournal/index.db
```

regardless of which directory you run `mywj` from, so everything you ingest ends up in one searchable knowledge base. Override the location with the `MYWJ_DB_PATH` environment variable if you want a per-project database instead.

> **Upgrading from an older version?** Prior versions stored the database at `<current-working-directory>/.myworkjournal/index.db`. That old data won't automatically show up under the new global path. Either move it:
>
> ```bash
> mkdir -p ~/.myworkjournal
> mv ./.myworkjournal/index.db ~/.myworkjournal/index.db
> mv ./.myworkjournal/captures ~/.myworkjournal/captures  # if you have any notes
> ```
>
> or set `MYWJ_DB_PATH=./.myworkjournal/index.db` to keep the old per-project behavior.

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
- **Global database by default** — `~/.myworkjournal/` holds everything you ingest, regardless of the directory you run `mywj` from. Set `MYWJ_DB_PATH` for a per-project database instead.
- **Fully local embeddings** — no API key or internet connection needed for ingestion after the model is cached.

---

## Roadmap

| Phase | Features |
|-------|----------|
| 1 ✅ | `.txt`, `.md`, `.rtf` — local embeddings — SQLite — hybrid FTS + semantic search — Claude streaming synthesis |
| 2 ✅ | Quick capture (`mywj note`) — edit + delete notes — Esc to cancel — interactive chat |
| 3 ✅ | URL ingestion (`mywj ingest-url <url>`) |
| 4 | Screenshot/image ingestion (`mywj ingest-image`) — vision-LLM transcription for auth-gated pages (Jira, Confluence) that can't be scraped directly |
| 5 | PDF parser |
| 6 | git log ingestion (`mywj ingest-git`) |
