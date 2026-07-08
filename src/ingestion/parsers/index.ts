// ─────────────────────────────────────────────────────────────────────────
// INGESTION PIPELINE — STEP 2: PARSE
// Strategy-pattern registry: picks the right Parser for a file extension and
// hands back raw text. Adding a new file type (PDF, DOCX) means writing one
// Parser and registering it here — nothing else in the pipeline changes.
// ─────────────────────────────────────────────────────────────────────────
import { Parser } from '../../types';
import { txtParser } from './txt';
import { markdownParser } from './markdown';
import { rtfParser } from './rtf';

export class ParserRegistry {
  private parsers: Parser[];

  constructor() {
    this.parsers = [txtParser, markdownParser, rtfParser];
  }

  getParser(extension: string): Parser | null {
    return this.parsers.find(p => p.supports(extension)) ?? null;
  }

  register(parser: Parser): void {
    this.parsers.push(parser);
  }
}
