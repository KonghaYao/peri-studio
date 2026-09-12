import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import tailwindcss from '@tailwindcss/vite';

// 设计稿沙箱：独立 Vite 项目，与 web/ 生产构建完全隔离。
// GitHub Pages 部署时通过 VITE_BASE_PATH 注入仓库子路径（如 /peri-studio/）。
export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  resolve: {
    alias: [
      { find: '@', replacement: resolve(import.meta.dirname, 'src') },
      {
        find: /^@peri\/markdown\/worker$/,
        replacement: resolve(
          import.meta.dirname,
          '../packages/markdown/src/workers/mermaidParser.worker.ts',
        ),
      },
      { find: /^@peri\/markdown$/, replacement: resolve(import.meta.dirname, '../packages/markdown/src') },
      {
        find: /^@peri\/ui\/styles\.css$/,
        replacement: resolve(import.meta.dirname, '../packages/ui/src/styles/index.css'),
      },
      { find: /^@peri\/ui$/, replacement: resolve(import.meta.dirname, '../packages/ui/src') },
    ],
  },
  optimizeDeps: {
    include: ['stream-markdown-parser', 'markstream-core'],
  },
  plugins: [solid(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5273,
    fs: {
      allow: [resolve(import.meta.dirname, '..')],
    },
    // Agent 写文件不一定触发 FSEvents；轮询才能热更新
    watch: { usePolling: true, interval: 300 },
  },
});
