/** PTY 输出写入与尺寸同步的浏览器终端视口契约（与后端协议解耦）。 */
export type TerminalViewport = {
  write(data: string | Uint8Array): void | Promise<void>;
  resize(cols: number, rows: number): void;
  focus(): void;
  /** 清空本地仿真器屏幕（不发送 PTY）。 */
  reset(): void;
  readonly cols: number;
  readonly rows: number;
};
