// ─────────────────────────────────────────────────────────────────────────
// URL INGESTION — STEP 1: FETCH
// Pulls raw HTML (or, for Google Docs, plain text) for a URL over the
// network. Rejects unsupported content types, oversized bodies, and
// redirect loops before anything gets parsed.
// ─────────────────────────────────────────────────────────────────────────
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_REDIRECTS = 5;

// Google Docs' normal /edit view is a JS-rendered app shell — the document
// body isn't in the raw HTML at all. /export?format=txt returns the actual
// text server-side, so any docs.google.com/document/d/<id>/... URL gets
// rewritten to that endpoint before fetching.
const GOOGLE_DOCS_PATTERN = /^https:\/\/docs\.google\.com\/document\/d\/([^/]+)/;

function rewriteGoogleDocsUrl(url: string): string {
  const match = url.match(GOOGLE_DOCS_PATTERN);
  if (!match) return url;
  return `https://docs.google.com/document/d/${match[1]}/export?format=txt`;
}

export interface FetchedPage {
  html: string;
  finalUrl: string;
  contentType: string;
  /** Filename from Content-Disposition (e.g. Google Docs export), sans extension. */
  filename?: string;
}

export interface FetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

export async function fetchUrl(url: string, options: FetchOptions = {}): Promise<FetchedPage> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES } = options;

  let currentUrl = rewriteGoogleDocsUrl(url);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(currentUrl, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'myworkjournal/0.4 (+https://github.com)' },
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new Error(`Timed out after ${timeoutMs}ms fetching ${currentUrl}`);
      }
      throw new Error(`Failed to fetch ${currentUrl}: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        throw new Error(`Redirect from ${currentUrl} had no Location header`);
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    if (!response.ok) {
      throw new Error(`${currentUrl} returned HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    const isSupported =
      contentType.includes('text/html') ||
      contentType.includes('application/xhtml+xml') ||
      contentType.includes('text/plain');
    if (!isSupported) {
      throw new Error(`${currentUrl} is not HTML or plain text (content-type: ${contentType || 'unknown'})`);
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength && Number(contentLength) > maxBytes) {
      throw new Error(`${currentUrl} exceeds max size of ${maxBytes} bytes`);
    }

    const html = await response.text();
    if (Buffer.byteLength(html, 'utf-8') > maxBytes) {
      throw new Error(`${currentUrl} exceeds max size of ${maxBytes} bytes`);
    }

    const disposition = response.headers.get('content-disposition') ?? '';
    const filenameMatch = disposition.match(/filename="?([^";]+)"?/);
    const filename = filenameMatch ? filenameMatch[1].replace(/\.[^.]+$/, '') : undefined;

    return { html, finalUrl: currentUrl, contentType, filename };
  }

  throw new Error(`Too many redirects (>${MAX_REDIRECTS}) starting from ${url}`);
}
