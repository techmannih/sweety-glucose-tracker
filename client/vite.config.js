import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { config as readEnvFile } from 'dotenv';
import { fileURLToPath } from 'node:url';

const { parsed } = readEnvFile({
  path: fileURLToPath(new URL('../.env', import.meta.url)),
  processEnv: {},
  quiet: true,
});
const apiPort = Number((process.env.PORT ?? parsed?.PORT) || 3001);
const apiHost = (process.env.HOST ?? parsed?.HOST) || '127.0.0.1';
const proxyHost = apiHost === '0.0.0.0' ? '127.0.0.1' : apiHost === '::' ? '::1' : apiHost;

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: { protocol: 'http:', host: proxyHost, port: apiPort } } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
  },
});
