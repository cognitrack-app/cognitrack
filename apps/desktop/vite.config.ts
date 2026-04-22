import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import 'dotenv/config';

/**
 * Vite config for the CogniTrack tray popover renderer.
 *
 * - Dev:   `vite` serves from src/renderer on :5173
 * - Build: outputs to dist-renderer/ (loaded by Electron in production)
 */
export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react()],
  define: {
    'process.env.FIREBASE_API_KEY': JSON.stringify(process.env.FIREBASE_API_KEY),
    'process.env.FIREBASE_AUTH_DOMAIN': JSON.stringify(process.env.FIREBASE_AUTH_DOMAIN),
    'process.env.FIREBASE_PROJECT_ID': JSON.stringify(process.env.FIREBASE_PROJECT_ID),
    'process.env.FIREBASE_STORAGE_BUCKET': JSON.stringify(process.env.FIREBASE_STORAGE_BUCKET),
    'process.env.FIREBASE_MESSAGING_SENDER_ID': JSON.stringify(process.env.FIREBASE_MESSAGING_SENDER_ID),
    'process.env.FIREBASE_APP_ID': JSON.stringify(process.env.FIREBASE_APP_ID),
  },
  build: {
    outDir: path.resolve(__dirname, 'dist-renderer'),
    emptyOutDir: true,
    sourcemap: process.env.NODE_ENV === 'development' ? 'inline' : false,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
