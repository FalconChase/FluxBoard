import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// App-shell dev server (design doc §8, §9 Milestone 2). This runs the
// same src/app + src/floor + src/core code that Tauri (FluxBoard PC,
// _brain/FLUXBOARD.md FBD009 rev.2) will eventually wrap — Tauri-
// specific calls stay isolated behind one adapter so plain `vite dev`
// keeps working standalone for fast iteration.
export default defineConfig({
  plugins: [react()],
  root: '.',
  build: {
    outDir: 'dist',
  },
});
