const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export function safeHref(value: unknown): string | null {
  const href = String(value || '').trim();
  if (!href || href.startsWith('//')) return null;
  if (/^#[^\u0000-\u0020]*$/u.test(href)) return href;
  try {
    const url = new URL(href, 'https://peri-studio.invalid/');
    if (!SAFE_PROTOCOLS.has(url.protocol)) return null;
    if (url.hostname === 'peri-studio.invalid' && !/^(?:https?:|mailto:)/i.test(href)) return null;
    return href;
  } catch {
    return null;
  }
}

export function safeRemoteImageSource(value: unknown) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}
