/** 从 design tokens 读取终端主题，供 xterm.js 256/truecolor 渲染对齐产品色板。 */
export function readXtermTheme() {
  const cssValue = (name: string, fallback: string) => {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  };
  return {
    background: cssValue('--terminal-viewport-bg', '#141414'),
    foreground: cssValue('--terminal-viewport-fg', '#f0f0f0'),
    cursor: cssValue('--terminal-viewport-accent', '#60a5fa'),
    selectionBackground: 'rgba(96, 165, 250, 0.3)',
    black: '#1e1e1e',
    red: '#f44747',
    green: '#6a9955',
    yellow: '#d7ba7d',
    blue: '#569cd6',
    magenta: '#c586c0',
    cyan: '#4ec9b0',
    white: '#d4d4d4',
    brightBlack: '#808080',
    brightRed: '#f44747',
    brightGreen: '#6a9955',
    brightYellow: '#d7ba7d',
    brightBlue: '#569cd6',
    brightMagenta: '#c586c0',
    brightCyan: '#4ec9b0',
    brightWhite: '#ffffff',
  };
}

/** xterm 专用字体栈：Latin mono + CJK，避免宽字符用错 fallback 导致笔画断裂。 */
export function readXtermFontFamily(): string {
  const mono = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim();
  const cjk = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei"';
  const latin = mono || 'Menlo, Monaco, Consolas, monospace';
  return `${latin}, ${cjk}, monospace`;
}
