import type { BaseNodeData } from '../model/nodes/BaseNode';

/** CSS/SVG affine coefficients: x'=a*x+c*y+e, y'=b*x+d*y+f. */
export type AffineMatrix = readonly [number, number, number, number, number, number];
const IDENTITY: AffineMatrix = [1, 0, 0, 1, 0, 0];

export function composeTransforms(
  parent: AffineMatrix = IDENTITY,
  child: AffineMatrix,
): AffineMatrix {
  const [a, b, c, d, e, f] = parent;
  const [g, h, i, j, k, l] = child;
  return [
    a * g + c * h,
    b * g + d * h,
    a * i + c * j,
    b * i + d * j,
    a * k + c * l + e,
    b * k + d * l + f,
  ];
}

/** Matches the renderer's translate + centre-origin rotate/flip order. */
export function nodeTransform(node: BaseNodeData, includeFlips = true): AffineMatrix {
  const angle = (node.rotation * Math.PI) / 180;
  const sx = includeFlips && node.flipH ? -1 : 1;
  const sy = includeFlips && node.flipV ? -1 : 1;
  const a = Math.cos(angle) * sx,
    b = Math.sin(angle) * sx;
  const c = -Math.sin(angle) * sy,
    d = Math.cos(angle) * sy;
  const cx = node.size.w / 2,
    cy = node.size.h / 2;
  return [
    a,
    b,
    c,
    d,
    node.position.x + cx - a * cx - c * cy,
    node.position.y + cy - b * cx - d * cy,
  ];
}

export function invertTransform(matrix: AffineMatrix): AffineMatrix {
  const [a, b, c, d, e, f] = matrix;
  const determinant = a * d - b * c;
  return [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant,
  ];
}
