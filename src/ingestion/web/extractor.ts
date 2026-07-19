// ─────────────────────────────────────────────────────────────────────────
// URL INGESTION — STEP 2: EXTRACT
// Turns a fetched page into a title + readable body. HTML pages go through
// Readability (same algorithm as Firefox Reader Mode) to strip nav/ads/
// boilerplate; plain-text responses (e.g. Google Docs export) are passed
// through as-is since there's no markup to strip.
// ─────────────────────────────────────────────────────────────────────────
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { FetchedPage } from './fetcher';

export interface ExtractedPage {
  title: string;
  textContent: string;
}

export function extract(page: FetchedPage): ExtractedPage {
  if (page.contentType.includes('text/plain')) {
    if (!page.html.trim()) {
      throw new Error(`${page.finalUrl} returned empty content`);
    }
    return {
      title: page.filename || page.finalUrl,
      textContent: page.html,
    };
  }

  const dom = new JSDOM(page.html, { url: page.finalUrl });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article || !article.textContent?.trim()) {
    throw new Error(`Could not extract readable content from ${page.finalUrl}`);
  }

  return {
    title: article.title || page.finalUrl,
    textContent: article.textContent,
  };
}
