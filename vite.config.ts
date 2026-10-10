import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    base: env.VITE_BASE_PATH || '/',
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        '/api': env.VITE_API_BASE_URL || 'http://127.0.0.1:8000',
        '/health': env.VITE_API_BASE_URL || 'http://127.0.0.1:8000',
      },
    },
  };
});
