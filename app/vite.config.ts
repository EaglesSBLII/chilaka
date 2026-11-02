import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

// base './' so the same build loads from file:// inside Electron and from any
// subpath when deployed as a PWA.
const BUILD_STAMP = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

export default defineConfig({
  base: './',
  define: {
    __BUILD_STAMP__: JSON.stringify(BUILD_STAMP),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Precache the whole app plus the default (female) voice so the iPhone
      // works fully offline from the first launch; the male voice is fetched
      // and kept the first time it is chosen.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,json}', 'audio/v-female/*.m4a', 'audio/*.m4a'], // audio/*.m4a: previous voice, until both native voices are complete
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/audio/v-male/'),
            handler: 'CacheFirst',
            options: { cacheName: 'voice-male', expiration: { maxEntries: 1300, maxAgeSeconds: 365 * 24 * 3600 } },
          },
        ],
      },
      manifest: {
        name: 'Chilaka — Telugu',
        short_name: 'Chilaka',
        description: 'Learn to speak Telugu fluently',
        theme_color: '#0E6B63',
        background_color: '#FFF8ED',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // Electron loads from file:// where service workers don't apply; the
      // registration module no-ops there.
      disable: false,
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
