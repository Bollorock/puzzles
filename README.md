# Puzzles

A jigsaw puzzle web app made for phones. It is an installable PWA and works offline.

- Pick a free photo, or use one of your own. The theme chips above the gallery switch between
  general photos from [Lorem Picsum](https://picsum.photos) (Unsplash) and colourful
  [Wikimedia Commons featured pictures](https://commons.wikimedia.org/wiki/Commons:Featured_pictures):
  **Flowers**, **Landscapes**, **Sunsets**, **Animals**, **Space** and **Art**. The finish screen
  credits the author and licence.
- Choose 12, 24, 48, 96, 150, 300 or 500 pieces. The grid adapts to the image's shape.
- Each side of a piece is an inside peg, an outside peg, or a flat edge.
- Pick **Classic** or **Unusual** shapes. Unusual pieces are cut on a wobbly grid, so they aren't
  rectangles, and mix round knobs with keys, dovetails, arrows and double knobs. The puzzle's
  outer border stays straight.
- Pieces that belong together snap when you drop them close to each other.
- Corner pieces snap into their corner of the dashed outline and lock there. Pieces joined to a
  locked piece lock too, so the finished frame can't be knocked out of place by accident.
- Pan by dragging the background. Zoom by pinching, or with the mouse wheel on desktop.
  Turn off **Pan and zoom the board** in **Settings** to keep the whole puzzle fitted to the screen
  instead; the fit button still refits it after you move pieces outside the frame.
- **Lift dragged pieces off your finger** in **Settings** shows the piece you drag beside your
  finger instead of under it: up-left, straight up or up-right, **Near** or **Far**. A piece picked
  up on the board slides into place over the first bit of movement, so a tap doesn't move it.
- The storage box at the bottom holds pieces in a random order. Swipe it sideways to scroll.
  - Drag a piece **upwards** to pull it onto the board, or tap it to drop it in the middle of the view.
  - Drop a single piece back onto the storage box to put it away.
  - Filter the box: **All**, **Edges** or **Non-edges**.
- **Store singles** moves every piece that isn't joined to another back into storage.
- Snapping plays a soft click and a short vibration, and finishing a puzzle plays a little chime.
  Both can be turned off in **Settings** (the sliders button). Vibration needs a device that supports it; iPhones do not.
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

`.github/workflows/deploy.yml` builds and deploys every push to `master`.
It needs a one-time setup: in the repository go to **Settings → Pages → Build and deployment → Source**
and choose **GitHub Actions**. The site is then published at `https://<user>.github.io/<repo>/`.
All asset paths are relative, so the build works from any sub-path.
