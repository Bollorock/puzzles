# Puzzles

A jigsaw puzzle web app made for phones. It is an installable PWA and works offline.

- Pick a free photo from [Lorem Picsum](https://picsum.photos) (Unsplash), or use one of your own.
- Choose 12, 24, 48, 96, 150, 300 or 500 pieces. The grid adapts to the image's shape.
- Each side of a piece is an inside peg, an outside peg, or a flat edge.
- Pieces that belong together snap when you drop them close to each other.
- Pan by dragging the background. Zoom by pinching, or with the mouse wheel on desktop.
- The storage box at the bottom holds pieces in a random order. Swipe it sideways to scroll.
  - Drag a piece **upwards** to pull it onto the board, or tap it to drop it in the middle of the view.
  - Drop a single piece back onto the storage box to put it away.
  - Filter the box: **All**, **Edges** or **Non-edges**.
- **Store singles** moves every piece that isn't joined to another back into storage.
- Progress saves automatically, so you can resume after closing the app.

## Development

The app is built with [Vite+](https://viteplus.dev) (`vp`) and TypeScript. It has no runtime dependencies.

```bash
npm install
npx vp dev      # dev server
npx vp check    # format, lint, type check
npx vp test     # unit tests
npx vp build    # production build in dist/
```

## Hosting on GitHub Pages

`.github/workflows/deploy.yml` builds and deploys every push to `main`.
It needs a one-time setup: in the repository go to **Settings → Pages → Build and deployment → Source**
and choose **GitHub Actions**. The site is then published at `https://<user>.github.io/<repo>/`.
All asset paths are relative, so the build works from any sub-path.
