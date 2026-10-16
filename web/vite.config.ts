import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Forward /api/* to the Hono server. The browser only ever talks to
    // localhost:5173, so cookies "just work" and no CORS is needed in development.
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: false },
    },
  },
});
