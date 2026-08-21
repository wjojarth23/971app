import "dotenv/config"
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    setupFiles: "vitest.setup.ts",
    environment: "node",
    env: {
      // For some reason vitest overwrites the BASE_URL env var
      BASE_URL: process.env.BASE_URL
    }
  }
})