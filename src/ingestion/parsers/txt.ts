// Parser: .txt — plain read, no transformation needed.
import * as fs from 'fs';
import { Parser } from '../../types';

export const txtParser: Parser = {
  supports(extension: string): boolean {
    return extension === '.txt';
  },
  async parse(filePath: string): Promise<string> {
    return fs.readFileSync(filePath, 'utf-8');
  },
};
