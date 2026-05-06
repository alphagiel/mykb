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
