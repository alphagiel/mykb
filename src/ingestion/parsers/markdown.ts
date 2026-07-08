// Parser: .md — plain read; markdown syntax is left as-is (it's readable
// text either way, and headers/lists give the LLM useful structure).
import * as fs from 'fs';
import { Parser } from '../../types';

export const markdownParser: Parser = {
  supports(extension: string): boolean {
    return extension === '.md';
  },
  async parse(filePath: string): Promise<string> {
    return fs.readFileSync(filePath, 'utf-8');
  },
};
