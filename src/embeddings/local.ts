import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { EmbeddingProvider } from '../types';

// Patch global fetch with a Node https-based implementation that handles redirects.
// Required on Windows where Node's built-in undici fetch fails to download from HuggingFace.
function nodeFetch(input: string, init: RequestInit = {}, redirects = 10): Promise<Response> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(input);
    const mod = parsed.protocol === 'https:' ? https : http;

    // Normalise headers — init.headers can be a Headers object, a [k,v][] array, or a plain object
    const rawHeaders = init.headers;
    const headersMap: Record<string, string> = {
      'User-Agent': 'node-fetch',
      'Accept': '*/*',
    };
    if (rawHeaders instanceof Headers) {
      rawHeaders.forEach((v, k) => { headersMap[k] = v; });
    } else if (Array.isArray(rawHeaders)) {
      for (const [k, v] of rawHeaders) headersMap[k] = v;
    } else if (rawHeaders) {
      Object.assign(headersMap, rawHeaders);
    }

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: (init.method as string) ?? 'GET',
      headers: headersMap,
    };

    const req = mod.request(options, (res) => {
      // Follow redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (redirects === 0) return reject(new Error('Too many redirects'));
        const location = res.headers.location;
        const next = location.startsWith('http') ? location : `${parsed.protocol}//${parsed.host}${location}`;
        res.resume(); // drain to free memory
        return resolve(nodeFetch(next, init, redirects - 1));
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve(
          new Response(Buffer.concat(chunks), {
            status: res.statusCode ?? 200,
            headers: res.headers as HeadersInit,
          })
        );
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    if (init.body) req.write(init.body as string);
    req.end();
  });
}

if (!(globalThis as any)._fetchPatched) {
  (globalThis as any)._fetchPatched = true;
  (globalThis as any).fetch = nodeFetch;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _extractor: any = null;

async function getExtractor() {
  if (!_extractor) {
    process.stderr.write('Loading embedding model (first run downloads ~25 MB)...\n');
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const { pipeline } = await import('@xenova/transformers');
    _extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    process.stderr.write('Embedding model ready.\n');
  }
  return _extractor as (
    text: string,
    opts: object
  ) => Promise<{ data: Float32Array }>;
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
