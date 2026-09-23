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
    // 不产出 sourcemap：既是体积考虑，也避免把源码结构暴露到公网
    sourcemap: false,
    // 公式相关依赖已拆成按需加载的分块（见 MarkdownRenderer），
    // 主包与其分块都应低于默认的 500 kB 阈值，因此不放开该限制。
  },
})
