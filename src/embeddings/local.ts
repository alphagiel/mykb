import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { EmbeddingProvider } from '../types';

/**
 * Node.js https-based fetch replacement.
 * Handles redirects (including relative ones) and all header formats.
 * Used only during model download to work around Windows TLS issues with HuggingFace.
 */
function nodeFetch(input: string, init: RequestInit = {}, redirects = 10): Promise<Response> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(input);
    const mod = parsed.protocol === 'https:' ? https : http;

    const headersMap: Record<string, string> = {
      'User-Agent': 'node-fetch',
      'Accept': '*/*',
    };
    const rawHeaders = init.headers;
    if (rawHeaders instanceof Headers) {
      rawHeaders.forEach((v, k) => { headersMap[k] = v; });
    } else if (Array.isArray(rawHeaders)) {
      for (const [k, v] of rawHeaders) headersMap[k] = v;
    } else if (rawHeaders) {
      Object.assign(headersMap, rawHeaders);
    }

    const req = mod.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: (init.method as string) ?? 'GET',
        headers: headersMap,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirects === 0) return reject(new Error('Too many redirects'));
          const loc = res.headers.location;
          const next = loc.startsWith('http') ? loc : `${parsed.protocol}//${parsed.host}${loc}`;
          res.resume();
          return resolve(nodeFetch(next, init, redirects - 1));
        }
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve(new Response(Buffer.concat(chunks), {
            status: res.statusCode ?? 200,
            headers: res.headers as HeadersInit,
          }))
        );
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    if (init.body) req.write(init.body as string);
    req.end();
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _extractor: any = null;

async function getExtractor() {
  if (!_extractor) {
    process.stderr.write('Loading embedding model (first run downloads ~25 MB)...\n');

    // Temporarily patch global fetch to fix Windows TLS issues with HuggingFace.
    // Restored immediately after so LLM provider streaming works normally.
    const savedFetch = (globalThis as any).fetch;
    (globalThis as any).fetch = nodeFetch;

    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const { pipeline } = await import('@xenova/transformers');
      _extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    } finally {
      (globalThis as any).fetch = savedFetch;
    }

    process.stderr.write('Embedding model ready.\n');
  }

  return _extractor as (text: string, opts: object) => Promise<{ data: Float32Array }>;
}

export function createLocalEmbeddingProvider(): EmbeddingProvider {
  return {
    async embed(text: string): Promise<number[]> {
      const extractor = await getExtractor();
      const output = await extractor(text, { pooling: 'mean', normalize: true });
      return Array.from(output.data);
    },
  };
}
