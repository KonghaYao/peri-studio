import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';
import tailwindcss from '@tailwindcss/vite';

// peri-studio 前端：单页应用（Web 面板为唯一页面，`/` 即面板入口），
// 构建产物 dist/ 由 peri-studio-server 的 build.rs 编译期内嵌（见 server/build.rs）。
// 产物文件名带内容 hash，Rust 端按实际文件清单生成路由表，无需约定固定名。
const rootDir = import.meta.dirname;
export default defineConfig({
  plugins: [solid(), tailwindcss()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        // 与 Rust 端路由保持的 URL 契约：`/` 即 Web 面板。
        index: resolve(rootDir, 'index.html'),
        // MCP Apps 沙箱页：第二 loopback origin（server sandbox listener）。
        sandbox: resolve(rootDir, 'sandbox.html'),
      },
      output: {
        manualChunks(id) {
          if (!id.includes('/node_modules/')) return undefined;
          if (id.includes('/yjs/') || id.includes('/lib0/')) return 'vendor-crdt';
          if (id.includes('/markdown-to-jsx/')) return 'vendor-markdown';
          if (id.includes('/@kobalte/')) return 'vendor-interactions';
          if (id.includes('/solid-js/')) return 'vendor-solid';
          return undefined;
        },
      },
    },
  },
});
