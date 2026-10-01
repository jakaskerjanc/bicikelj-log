import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

const REQUIRED_BUILD_ENV = ['VITE_MAPBOX_TOKEN', 'VITE_DATA_BASE_URL'];

export default defineConfig(({ command, mode }) => {
  // Only `vite build` checks: a missing token would ship a blank map. dev and Vitest don't need them.
  if (command === 'build') {
    const env = loadEnv(mode, process.cwd(), 'VITE_');
    const missing = REQUIRED_BUILD_ENV.filter((key) => !env[key]);
    if (missing.length > 0) {
      throw new Error(`Missing build environment variables: ${missing.join(', ')}`);
    }
  }
  return {
    base: '/bicikelj-log/',
    plugins: [react()],
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
    },
  };
});
