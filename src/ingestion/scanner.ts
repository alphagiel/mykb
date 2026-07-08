// ─────────────────────────────────────────────────────────────────────────
// INGESTION PIPELINE — STEP 1: SCAN
// Recursively walks a directory, filters by extension/size, and returns a
// flat list of files to ingest. Pure filesystem discovery — no parsing yet.
// Flow: scan → parse → normalize → chunk → embed → store
// ─────────────────────────────────────────────────────────────────────────
import * as fs from 'fs';
import * as path from 'path';
import { FileDescriptor } from '../types';

export interface ScanOptions {
  extensions?: string[];
  maxSizeBytes?: number;
  exclude?: string[];
}

const DEFAULT_EXTENSIONS = ['.txt', '.md', '.rtf'];
const DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const DEFAULT_EXCLUDE = ['.mykb', 'node_modules', '.git', 'dist'];

export function scan(dirPath: string, options: ScanOptions = {}): FileDescriptor[] {
  const {
    extensions = DEFAULT_EXTENSIONS,
    maxSizeBytes = DEFAULT_MAX_SIZE,
    exclude = DEFAULT_EXCLUDE,
  } = options;

  const results: FileDescriptor[] = [];
  walk(path.resolve(dirPath), extensions, maxSizeBytes, exclude, results);
  return results;
}

function walk(
  dirPath: string,
  extensions: string[],
  maxSizeBytes: number,
  exclude: string[],
  results: FileDescriptor[]
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (exclude.includes(entry.name)) continue;

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      walk(fullPath, extensions, maxSizeBytes, exclude, results);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!extensions.includes(ext)) continue;

      let stats: fs.Stats;
      try {
        stats = fs.statSync(fullPath);
      } catch {
        continue;
      }

      if (stats.size > maxSizeBytes) continue;

      results.push({ path: fullPath, extension: ext, sizeBytes: stats.size });
    }
  }
}
