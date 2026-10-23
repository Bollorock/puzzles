import { describe, expect, it } from 'vite-plus/test';
import { offsetVector } from './prefs';

describe('offsetVector', () => {
  it('is null when turned off', () => {
    expect(offsetVector('off', 'far')).toBeNull();
  });

  it('points up, up-left or up-right, further when far', () => {
    expect(offsetVector('up', 'near')).toEqual({ x: 0, y: -60 });
    const left = offsetVector('upLeft', 'near')!;
    const right = offsetVector('upRight', 'near')!;
    expect(left.x).toBeLessThan(0);
    expect(right.x).toBeCloseTo(-left.x);
    expect(left.y).toBeLessThan(0);
    expect(Math.hypot(left.x, left.y)).toBeCloseTo(60);
    expect(Math.hypot(...Object.values(offsetVector('upRight', 'far')!))).toBeCloseTo(110);
  });
});
