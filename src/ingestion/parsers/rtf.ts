// Parser: .rtf — strips RTF control codes down to plain text with a small
// regex-based decoder, avoiding an extra dependency for a simple format.
import * as fs from 'fs';
import { Parser } from '../../types';

/**
 * Basic RTF stripper — handles control words, unicode escapes, and paragraph breaks.
 * Sufficient for plain-text RTF files in Phase 1.
 */
function stripRtf(rtf: string): string {
  // Decode unicode escapes: \uN? where N is a signed decimal codepoint
  let text = rtf.replace(/\\u(-?\d+)\??/g, (_, code) => {
    const n = parseInt(code, 10);
    return String.fromCharCode(n < 0 ? n + 65536 : n);
  });

  // Paragraph and line breaks → newline
  text = text.replace(/\\(?:par|pard|line)\b ?/g, '\n');

  // Remove starred destinations (e.g. {\*\generator ...})
  text = text.replace(/\{\\\*[^}]*\}/g, '');

  // Remove all remaining control words (with optional signed numeric param + trailing space)
  text = text.replace(/\\[a-z]+(?:-?\d+)? ?/gi, '');

  // Remove control symbols (backslash + non-alpha)
  text = text.replace(/\\[^a-z\s]/gi, '');

  // Remove group delimiters
  text = text.replace(/[{}]/g, '');

  // Normalise whitespace
  text = text.replace(/\r/g, '');
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

export const rtfParser: Parser = {
  supports(extension: string): boolean {
    return extension === '.rtf';
  },
  async parse(filePath: string): Promise<string> {
    const raw = fs.readFileSync(filePath, 'latin1');
    return stripRtf(raw);
  },
};
