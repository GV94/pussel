# Pussel

A free, open-source jigsaw puzzle app for the iPad. No ads, no accounts, no tracking. English and Swedish.

Live: https://gv94.github.io/pussel/

This is the web mockup. It runs in Safari and can be added to the iPad home screen, where it opens full screen like an app. The native iOS version comes later.

## Running it

```sh
npm install
npm run dev        # http://localhost:5173
npm run dev:ipad   # same, but reachable from an iPad on the same Wi-Fi
npm test
npm run build      # static files in dist/, host anywhere
```

On the iPad, open the address that `dev:ipad` prints, tap Share, then "Add to Home Screen".

## Offline

It's a PWA: add it to the home screen and it opens full screen like an app. After one visit online it works without internet. The app and the eight bundled pictures are stored on install; every Commons picture is stored the first time it is shown (up to 120). Offline, the gallery shows only pictures that are on the device, and "Recent" lists pictures you have played. The service worker is `public/sw.js` and only runs in the built app, not on the dev server.

Every push to `main` builds and deploys to GitHub Pages (`.github/workflows/deploy.yml`).

## How it plays

- Pick a picture, pick how many pieces: 6, 12, 20, 35, 50 or 144. At 144 the pieces are small on screen; zoom and the large-piece tray make them workable.
- Pieces wait in a tray beside the board, shown large a few at a time (2×2 on a phone). Swipe the tray or use the arrows to page through them; it wraps around endlessly. On an iPad, "All pieces" switches to a scrollable view of every piece.
- Tap a piece to select it (yellow outline), then tap the spot on the picture where it goes. A wrong spot flashes red; after three misses the right spot pulses yellow.
- Press and hold on the picture for a magnifier that previews the picked piece in the spot under your finger. Let go to place it.
- Dragging also works: drop a piece near where it belongs and it clicks into place. Pieces dropped elsewhere stay on the table.
- Pieces never need rotating and only stick in the right spot, so nothing can get tangled.
- A faint guide picture on the board can be turned off. The eye button toggles a preview of the whole picture on the board. "Gather pieces" puts loose pieces back in the tray, edge pieces first.
- Progress saves automatically. The home screen offers "Continue puzzle".
- You can use your own photo from the iPad.

## Pictures

Pictures come from [Wikimedia Commons](https://commons.wikimedia.org), limited to files marked CC0 or public domain in Commons structured data, and double-checked against the licence name. Topics draw on Commons' "Quality images" and "Featured pictures" categories. No API key is needed. Eight pictures are bundled in `public/samples/` so the app works offline; their credits are in `public/samples/credits.json`.

## Code

- `src/puzzle/geometry.ts`: grid choice and piece shapes (pure, unit-tested)
- `src/puzzle/game.ts`: canvas board, tray, drag and snap
- `src/images.ts`: Wikimedia Commons search and own-photo import
- `src/main.ts`: screens
- `src/i18n.ts`: English and Swedish strings

## License

MIT. Bundled pictures are CC0 or public domain.
