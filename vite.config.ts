import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the site from /<repo>/; the deploy workflow sets BASE_PATH.
  base: process.env.BASE_PATH ?? '/',
  server: {
    host: '127.0.0.1',
    port: 5199,
    strictPort: true,
    // Allow access through `tailscale serve` (https://<machine>.<tailnet>.ts.net).
    allowedHosts: ['.ts.net'],
  },
});
