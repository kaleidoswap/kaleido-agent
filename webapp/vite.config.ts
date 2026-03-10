import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api/agent': {
        target: 'http://127.0.0.1:4242',
        rewrite: (path) => path.replace(/^\/api\/agent/, ''),
        changeOrigin: true,
      },
    },
  },
})
