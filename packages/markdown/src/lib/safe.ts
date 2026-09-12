export function safeHref(value: string | undefined | null) {
  const href = String(value ?? '').trim();
  if (!href || href.startsWith('//')) return null;
  if (href.startsWith('#')) return href;
  try {
    const url = new URL(href, 'https://peri.invalid');
    if (url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:') return href;
  } catch {
    return null;
  }
  return null;
}

export function safeRemoteImageSource(value: string | undefined | null) {
  const source = String(value ?? '').trim();
  if (!source) return null;
  try {
    const url = new URL(source);
    if (url.protocol === 'https:' || url.protocol === 'http:') return source;
  } catch {
    return null;
  }
  return null;
}
