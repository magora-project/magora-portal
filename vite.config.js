import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Magora',
        short_name: 'Magora',
        description: 'An open-source ecological intelligence network, listening to the living world.',
        start_url: '/',
        display: 'standalone',
        background_color: '#0d2818',
        theme_color: '#0d2818',
        orientation: 'portrait-primary',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the app shell so the UI loads offline; SPA routes fall back to index.html
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: '/index.html',
        // Don't precache the giant decorative SVGs (500KB+) — let them cache at runtime instead
        globIgnores: ['**/icons/{about,add_node,dashboard,donate,live_feed}.svg', '**/icons/icon-512.png.webp'],
        runtimeCaching: [
          {
            // Google Fonts stylesheets + font files
            urlPattern: ({ url }) =>
              url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Leaflet map tiles
            urlPattern: ({ url }) => /tile\.openstreetmap\.org|basemaps|tiles?\./.test(url.hostname),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'map-tiles',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Species photos (Wikipedia / Wikimedia)
            urlPattern: ({ url }) => /wikipedia\.org|wikimedia\.org/.test(url.hostname),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'species-images',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
