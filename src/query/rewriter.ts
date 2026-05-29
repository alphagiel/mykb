import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { ConversationTurn } from '../types';

const FOLLOW_UP_PATTERN = /^(what|how|why|who|where|when|did|does|is|are|was|were|will|would|could|can|has|have|had|do|does|it|that|this|these|those|they|he|she|we)\b/i;
const SHORT_QUESTION_THRESHOLD = 8;

function looksLikeFollowUp(question: string): boolean {
  const wordCount = question.split(/\s+/).length;
  if (wordCount <= 3) return true;
  if (FOLLOW_UP_PATTERN.test(question.trim()) && wordCount <= SHORT_QUESTION_THRESHOLD) return true;
  return false;
}

export async function rewriteQuery(
  question: string,
  history?: ConversationTurn[]
): Promise<string> {
  if (!history || history.length === 0 || !looksLikeFollowUp(question)) {
    return question;
  }

  const lastTurn = history[history.length - 1];
  const model = process.env.OLLAMA_MODEL ?? 'llama3.2';
  const baseUrl = process.env.OLLAMA_URL ?? 'http://localhost:11434';

  const prompt = [
    `Given this conversation:`,
    `User: ${lastTurn.question}`,
    `Assistant: ${lastTurn.answer}`,
    ``,
    `Rewrite the follow-up question as a standalone question. Reply with ONLY the rewritten question, nothing else.`,
    `Follow-up: ${question}`,
    `Standalone:`,
  ].join('\n');

  const body = JSON.stringify({ model, prompt, stream: false, options: { num_predict: 80 } });

  try {
    return await new Promise<string>((resolve, reject) => {
      const parsed = new URL(`${baseUrl}/api/generate`);
      const mod = parsed.protocol === 'https:' ? https : http;

      const req = mod.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === 'https:' ? 443 : 11434),
          path: parsed.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: 5000,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data) as { response?: string };
              const rewritten = parsed.response?.trim();
              if (rewritten && rewritten.length > 0) {
                resolve(rewritten);
              } else {
                resolve(question);
              }
            } catch {
              resolve(question);
            }
          });
        }
      );

      req.on('error', () => resolve(question));
      req.on('timeout', () => { req.destroy(); resolve(question); });
      req.write(body);
      req.end();
    });
  } catch {
    return question;
  }
}
