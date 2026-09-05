import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub project Pages lives under /repository/; localhost stays at /.
const base = process.env.VITE_BASE_PATH || '/';
if (!/^\/(?:[A-Za-z0-9._-]+\/)*$/.test(base)) {
  throw new Error('VITE_BASE_PATH harus berupa path absolut berakhiran /, misalnya /TradingViewRemote/.');
}

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      base,
      scope: base,
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'TradingView Remote',
        short_name: 'TV Remote',
        description: 'Analisis chart dari genggaman Anda',
        lang: 'id',
        id: base,
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#0c1017',
        theme_color: '#0c1017',
        icons: [
          { src: `${base}icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${base}icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        navigateFallback: `${base}index.html`,
        navigateFallbackDenylist: [/\/__\/auth/],
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
