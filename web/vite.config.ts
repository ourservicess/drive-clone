import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5000,
    strictPort: true, // fail loudly instead of silently switching to another port
    // Forward /api/* to the Hono server. The browser only ever talks to
    // localhost:5000, so cookies "just work" and no CORS is needed in development.
    proxy: {
      '/api': { target: 'http://localhost:5001', changeOrigin: false },
    },
  },
});
