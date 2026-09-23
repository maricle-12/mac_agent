import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true,
    watch: {
      // worker/ 是独立的子项目（有自己的 tsconfig 与 node_modules）。
      // 不排除的话，改动 worker 会让 Vite 清缓存并强制整页刷新，开发时会莫名其妙地闪。
      ignored: ['**/worker/**', '**/screenshots/**', '**/project_memory/**'],
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // KaTeX 体积较大，阶段 13 做代码分割后再收紧该阈值
    chunkSizeWarningLimit: 900,
  },
})
