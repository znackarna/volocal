import { describe, expect, it } from "vitest";

import { GLYPH, SMILE, smileArc } from "./brandArt";

/** Every point the drawn smile actually passes through.
 *
 *  `GLYPH.smile` is cubics, so only some of its numbers are on the curve: the
 *  `M` point, the last pair of each `C`, and each `L` point. The control points
 *  in between are off the curve by design and would fail every check below.
 */
function onCurvePoints(d: string): Array<[number, number]> {
  const tokens = d.match(/[MCLZ]|-?\d+\.?\d*/g) ?? [];
  const points: Array<[number, number]> = [];
  let i = 0;
  while (i < tokens.length) {
    const command = tokens[i];
    i += 1;
    if (command === "M" || command === "L") {
      points.push([Number(tokens[i]), Number(tokens[i + 1])]);
      i += 2;
    } else if (command === "C") {
      points.push([Number(tokens[i + 4]), Number(tokens[i + 5])]);
      i += 6;
    }
  }
  return points;
}

const radius = ([x, y]: [number, number]) => Math.hypot(x - SMILE.cx, y - SMILE.cy);
/** Degrees from the bottom of the arc, signed: positive to the right. */
const halfAngle = ([x, y]: [number, number]) =>
  (Math.atan2(x - SMILE.cx, y - SMILE.cy) * 180) / Math.PI;

/** The four corners `smileArc` emits, in the order it emits them. */
function corners(d: string): Array<[number, number]> {
  const numbers = (d.match(/-?\d+\.?\d*/g) ?? []).map(Number);
  /* M x y | A rx ry rot large sweep x y | L x y | A rx ry rot large sweep x y */
  return [
    [numbers[0], numbers[1]],
    [numbers[7], numbers[8]],
    [numbers[9], numbers[10]],
    [numbers[16], numbers[17]],
  ];
}

describe("smileArc reproduces the drawn smile", () => {
  const drawn = onCurvePoints(GLYPH.smile);

  it("reads eleven on-curve points off the drawing", () => {
    /* Five along the outer edge, five along the inner one, and the closing `L`
       back to the start. If a redraw changes how many cubics the shape is built
       from, everything below is measuring something else and should be
       re-derived rather than re-tuned. */
    expect(drawn).toHaveLength(11);
  });

  it("puts every one of them on one of the two circles", () => {
    for (const point of drawn) {
      const r = radius(point);
      const nearest = Math.abs(r - SMILE.outer) < Math.abs(r - SMILE.inner) ? SMILE.outer : SMILE.inner;
      expect(Math.abs(r - nearest)).toBeLessThan(0.001);
    }
  });

  it("reaches exactly the resting half-angle and no further", () => {
    const reach = Math.max(...drawn.map((point) => Math.abs(halfAngle(point))));
    expect(reach).toBeCloseTo(SMILE.rest, 3);
  });

  it("emits the drawing's own four corners at rest", () => {
    /* The drawing's corners, in `smileArc`'s order: outer right, outer left,
       inner left, inner right. Straight out of `GLYPH.smile`. */
    const expected: Array<[number, number]> = [
      [34.9735, 21.1465],
      [20.3465, 21.1465],
      [22.5406, 18.9524],
      [32.7794, 18.9524],
    ];
    corners(smileArc(SMILE.rest)).forEach(([x, y], index) => {
      expect(x).toBeCloseTo(expected[index][0], 3);
      expect(y).toBeCloseTo(expected[index][1], 3);
    });
  });

  it("keeps both radii when it opens", () => {
    for (const point of corners(smileArc(70))) {
      const r = radius(point);
      const nearest = Math.abs(r - SMILE.outer) < Math.abs(r - SMILE.inner) ? SMILE.outer : SMILE.inner;
      expect(Math.abs(r - nearest)).toBeLessThan(0.001);
    }
  });

  it("turns the arc flag over past a half circle", () => {
    expect(smileArc(80)).toContain(`${SMILE.outer} 0 0 1 `);
    expect(smileArc(100)).toContain(`${SMILE.outer} 0 1 1 `);
  });
});
