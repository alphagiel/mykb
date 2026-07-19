// ─────────────────────────────────────────────────────────────────────────
// SHARED CONTRACTS
// The interfaces here (Parser, EmbeddingProvider, VectorStore, LLMProvider)
// are what make every pipeline stage swappable: ingestion/engines/*.ts and
// query/engine.ts only ever depend on these shapes, never on a concrete
// implementation (SQLite, MiniLM, Claude, etc). New parser/embedding/LLM/
// vector-store backends plug in without touching pipeline logic.
// ─────────────────────────────────────────────────────────────────────────
export interface FileDescriptor {
  path: string;
  extension: string;
  sizeBytes: number;
}

export interface ParsedDocument {
  content: string;
  metadata: {
    filePath: string;
    extension: string;
    contentHash: string;
  };
}

export interface Chunk {
  documentId: number;
  content: string;
  chunkIndex: number;
}

export interface FileMetadata {
  createdAt: Date;
  modifiedAt: Date;
  sizeBytes: number;
}

export interface SearchResult {
  content: string;
  filePath: string;
  chunkIndex: number;
  similarity: number;
  fileCreatedAt?: Date;
  fileModifiedAt?: Date;
}

export interface Parser {
  supports(extension: string): boolean;
  parse(filePath: string): Promise<string>;
}

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  answerText?: string;
}

export interface ConversationTurn {
  question: string;
  answer: string;
}

export interface LLMProvider {
  answer(question: string, context: string, history?: ConversationTurn[], signal?: AbortSignal): Promise<UsageStats | null>;
}

export interface VectorStore {
  addDocument(filePath: string, contentHash: string, meta?: FileMetadata): Promise<number>;
  documentExists(filePath: string, contentHash: string): Promise<boolean>;
  addChunk(documentId: number, content: string, embedding: number[], chunkIndex: number): Promise<void>;
  deleteDocument(filePath: string): Promise<void>;
  similaritySearch(queryEmbedding: number[], k: number): Promise<SearchResult[]>;
  ftsSearch(query: string): Promise<SearchResult[]>;
  getStats(): Promise<{ documentCount: number; chunkCount: number }>;
}
