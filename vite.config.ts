import { defineConfig } from 'vite';

// Identifies this build. The app compares it with version.json on the server to
// notice when a newer version has been deployed.
const build = Date.now().toString(36);

export default defineConfig({
  // GitHub Pages serves the site from /<repo>/; the deploy workflow sets BASE_PATH.
  base: process.env.BASE_PATH ?? '/',
  define: { __BUILD__: JSON.stringify(build) },
  plugins: [
    {
      name: 'version-file',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build }) });
      },
    },
  ],
  server: {
    host: '127.0.0.1',
    port: 5199,
    strictPort: true,
    // Allow access through `tailscale serve` (https://<machine>.<tailnet>.ts.net).
    allowedHosts: ['.ts.net'],
  },
});
