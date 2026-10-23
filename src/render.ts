// Turns piece shapes into cut-out bitmaps (with a light bevel) and thumbnails.

import type { Layout, PieceShape } from './geometry';

/** Total bitmap pixels to aim for across all pieces (~48 MB of RGBA). */
const PIXEL_BUDGET = 12_000_000;

export interface PieceSprite {
  canvas: HTMLCanvasElement;
  /** Outline in piece-local board units, for hit testing. */
  path: Path2D;
}

export function piecePath(shape: PieceShape): Path2D {
  const p = new Path2D();
  const start = shape.outline[shape.outline.length - 1].to;
  p.moveTo(start.x, start.y);
  for (const s of shape.outline) {
    if (s.kind === 'line') p.lineTo(s.to.x, s.to.y);
    else p.bezierCurveTo(s.c1.x, s.c1.y, s.c2.x, s.c2.y, s.to.x, s.to.y);
  }
  p.closePath();
  return p;
}

export function renderScaleFor(layout: Layout): number {
  const { cols, rows, pieceW, pieceH, pad } = layout;
  const total = cols * rows * (pieceW + 2 * pad) * (pieceH + 2 * pad);
  return Math.min(1, Math.sqrt(PIXEL_BUDGET / total));
}

export function renderPieces(
  image: CanvasImageSource,
  layout: Layout,
  shapes: PieceShape[],
  scale: number,
): PieceSprite[] {
  const { pieceW: w, pieceH: h, pad, width, height } = layout;
  const cw = Math.ceil((w + 2 * pad) * scale);
  const ch = Math.ceil((h + 2 * pad) * scale);
  const line = Math.min(w, h) * 0.022;

  return shapes.map((shape) => {
    const path = piecePath(shape);
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.translate(pad, pad);
    ctx.save();
    ctx.clip(path);

    // Only copy the part of the image under this piece (plus its pegs).
    const ox = shape.col * w;
    const oy = shape.row * h;
    const sx = Math.max(0, ox - pad);
    const sy = Math.max(0, oy - pad);
    const sw = Math.min(width, ox + w + pad) - sx;
    const sh = Math.min(height, oy + h + pad) - sy;
    ctx.drawImage(image, sx, sy, sw, sh, sx - ox, sy - oy, sw, sh);

    // Bevel: light along the top-left inner edge, shade along the bottom-right.
    ctx.lineJoin = 'round';
    ctx.lineWidth = line * 2;
    ctx.translate(line * 0.7, line * 0.7);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.stroke(path);
    ctx.translate(-line * 1.4, -line * 1.4);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.stroke(path);
    ctx.restore();

    ctx.lineWidth = Math.max(line * 0.35, 0.6 / scale);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.stroke(path);
    return { canvas, path };
  });
}

/** Draws a sprite scaled to fit a square thumbnail canvas. */
export function drawThumb(target: HTMLCanvasElement, sprite: HTMLCanvasElement) {
  const ctx = target.getContext('2d')!;
  const s = Math.min(target.width / sprite.width, target.height / sprite.height);
  const dw = sprite.width * s;
  const dh = sprite.height * s;
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sprite, (target.width - dw) / 2, (target.height - dh) / 2, dw, dh);
}
