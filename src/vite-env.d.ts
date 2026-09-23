/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Worker 转发端点，例如 http://localhost:8787/api/chat */
  readonly VITE_API_ENDPOINT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
