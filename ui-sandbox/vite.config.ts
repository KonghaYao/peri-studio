import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import tailwindcss from '@tailwindcss/vite';

// 设计稿沙箱：独立 Vite 项目，与 web/ 生产构建完全隔离。
// GitHub Pages 部署时通过 VITE_BASE_PATH 注入仓库子路径（如 /peri-studio/）。
export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  plugins: [solid(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5273,
    // Agent 写文件不一定触发 FSEvents；轮询才能热更新
    watch: { usePolling: true, interval: 300 },
  },
});
