import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { LLMProvider } from '../types';

const SYSTEM = `You are a helpful assistant answering questions from a private knowledge base.
Use only the provided context. If the answer is not there, say so clearly. Be concise.`;

export function createOllamaProvider(model: string): LLMProvider {
  const baseUrl = process.env.OLLAMA_URL ?? 'http://localhost:11434';

  return {
    async answer(question: string, context: string): Promise<void> {
      const prompt = `${SYSTEM}\n\nContext:\n${context}\n\nQuestion: ${question}`;
      const body = JSON.stringify({ model, prompt, stream: true });

      return new Promise((resolve, reject) => {
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
          },
          (res) => {
            if (res.statusCode !== 200) {
              reject(new Error(`Ollama returned HTTP ${res.statusCode}. Is Ollama running?`));
              return;
            }

            let buffer = '';
            res.on('data', (chunk: Buffer) => {
              buffer += chunk.toString();
              const lines = buffer.split('\n');
              buffer = lines.pop() ?? '';
              for (const line of lines) {
                if (!line.trim()) continue;
                try {
                  const data = JSON.parse(line) as { response?: string };
                  if (data.response) process.stdout.write(data.response);
                } catch {
                  // ignore malformed lines
                }
              }
            });

            res.on('end', () => {
              process.stdout.write('\n');
              resolve();
            });

            res.on('error', reject);
          }
        );

        req.on('error', (err) => {
          reject(new Error(`Could not connect to Ollama at ${baseUrl}. Is it running?\n${err.message}`));
        });

        req.write(body);
        req.end();
      });
    },
  };
}
