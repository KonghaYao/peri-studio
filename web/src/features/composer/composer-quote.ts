import { createSignal } from 'solid-js';

export interface ComposerQuoteRequest {
  id: number;
  text: string;
  source: string;
}

const [composerQuoteRequest, setComposerQuoteRequest] = createSignal<ComposerQuoteRequest | null>(null);
let nextQuoteId = 1;

export { composerQuoteRequest };

export function requestComposerQuote(text: string, source = 'Peri'): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  setComposerQuoteRequest({ id: nextQuoteId++, text: normalized, source });
  return true;
}

export function resetComposerQuoteRequest(): void {
  setComposerQuoteRequest(null);
}

export function consumeComposerQuoteRequest(id: number): void {
  if (composerQuoteRequest()?.id === id) setComposerQuoteRequest(null);
}

export function formatComposerQuote(request: ComposerQuoteRequest): string {
  const body = request.text.split('\n').map((line) => `> ${line}`).join('\n');
  return `> ${request.source}\n${body}`;
}
