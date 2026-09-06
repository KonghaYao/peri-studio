/** 终端内可点击 URL 的默认打开方式（noopener，降低 tabnabbing 风险）。 */
export function openTerminalWebLink(_event: MouseEvent, uri: string): void {
  try {
    const url = new URL(uri);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    window.open(url.href, '_blank', 'noopener,noreferrer');
  } catch {
    // 非合法 URL 时忽略
  }
}
