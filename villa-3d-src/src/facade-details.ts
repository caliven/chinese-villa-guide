import * as THREE from "three";
import { box, slab, rect, hipRoof, cylinder, type Mats } from "./primitives";
import type { Point } from "./data";

// 参考图中的层叠石材线脚。尺寸为最外缘，后续构件不得再向外加厚。
export function cornice(
  parent: THREE.Object3D,
  x: number, z: number, w: number, d: number, top: number,
  mat: Mats,
) {
  const group = new THREE.Group();
  group.name = "层叠檐口";
  parent.add(group);
  for (const [inset, down, height, material] of [
    [0.2, 0.45, 0.15, mat.trim],
    [0.13, 0.32, 0.11, mat.trim],
    [0.065, 0.21, 0.08, mat.stone],
    [0, 0.13, 0.1, mat.trim],
    [0.025, 0.03, 0.03, mat.dark],
  ] as const) {
    slab(group, rect(x + inset, z + inset, w - 2 * inset, d - 2 * inset), top - down, height, material);
  }
  return group;
}

export function meander(
  parent: THREE.Object3D,
  x: number, y: number, z: number, width: number, mat: Mats,
) {
  const pitch = 0.28;
  for (let i = 0; i < Math.floor(width / pitch); i++) {
    const xx = x + i * pitch;
    box(parent, xx + 0.12, y + 0.09, z, 0.24, 0.025, 0.028, mat.stone);
    box(parent, xx + 0.23, y, z, 0.025, 0.18, 0.028, mat.stone);
    box(parent, xx + 0.14, y - 0.075, z, 0.18, 0.025, 0.028, mat.stone);
    box(parent, xx + 0.065, y - 0.01, z, 0.025, 0.14, 0.028, mat.stone);
    box(parent, xx + 0.12, y + 0.045, z, 0.11, 0.025, 0.028, mat.stone);
  }
}

export function carvedPilaster(
  parent: THREE.Object3D, x: number, z: number, base: number,
  height: number, width: number, mat: Mats,
) {
  box(parent, x, base + height / 2, z, width, height, 0.56, mat.trim);
  // 柱础只比柱身略宽。再宽 12cm 时，角柱侧面正好落在东西墙外皮上。
  box(parent, x, base + 0.27, z - 0.02, width + 0.04, 0.54, 0.66, mat.stone);
  box(parent, x, base + 0.38, z - 0.37, width - 0.02, 0.49, 0.08, mat.trim);
  for (const offset of [-0.18, -0.09, 0, 0.09, 0.18])
    box(parent, x + offset, base + height / 2 - 0.12, z - 0.36, 0.025, height - 1.85, 0.03, mat.wall);
  for (const [down, w, h, depth] of [
    [0.22, width + 0.24, 0.16, 0.76],
    [0.48, width + 0.04, 0.15, 0.66],
    [0.82, width + 0.16, 0.14, 0.7],
  ])
    box(parent, x, base + height - down, z - 0.02, w, h, depth, mat.trim);
  for (let i = -2; i <= 2; i++)
    box(parent, x + i * 0.085, base + height - 0.65, z - 0.335, 0.035, 0.18, 0.065, mat.stone);
  meander(parent, x - width / 2 + 0.04, base + 0.82, z - 0.36, width - 0.08, mat);
}

export function glassBalustrade(
  parent: THREE.Object3D, a: Point, b: Point, y: number, mat: Mats,
  omitStart = false,
) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const g = new THREE.Group();
  g.position.set(a[0], y, a[1]);
  g.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
  g.name = "三楼玻璃栏板与石材望柱";
  parent.add(g);
  const count = Math.ceil(length / 2.3);
  for (let i = 0; i < count; i++) {
    const span = length / count;
    box(g, (i + 0.5) * span, 0.59, 0, span - 0.24, 0.86, 0.03, mat.glass, false);
    box(g, (i + 0.5) * span, 1.055, 0, span, 0.055, 0.075, mat.dark);
  }
  for (let i = omitStart ? 1 : 0; i <= count; i++) {
    const xx = i * length / count;
    box(g, xx, 0.53, 0, 0.25, 1.06, 0.25, mat.trim);
    box(g, xx, 1.085, 0, 0.34, 0.09, 0.34, mat.stone);
    box(g, xx, 0.58, -0.14, 0.16, 0.61, 0.025, mat.stone);
    box(g, xx, 0.58, -0.158, 0.105, 0.51, 0.018, mat.trim);
  }
}

// 坡瓦收于有底、有外挡边的环形天沟内。瓦边缩进，避免穿出天沟及用地边界。
export function gutteredRoof(
  parent: THREE.Object3D,
  x: number, z: number, w: number, d: number,
  base: number, rise: number, mat: Mats,
) {
  const g = new THREE.Group();
  g.name = "四坡五脊瓦顶与环形天沟";
  parent.add(g);
  cornice(g, x, z, w, d, base, mat);
  const gutterWidth = 0.26;
  slab(g, rect(x, z, w, d), base + 0.025, 0.075, mat.dark, [
    rect(x + gutterWidth, z + gutterWidth, w - 2 * gutterWidth, d - 2 * gutterWidth),
  ]).name = "天沟槽底";
  slab(g, rect(x, z, w, d), base + 0.22, 0.195, mat.trim, [
    rect(x + 0.07, z + 0.07, w - 0.14, d - 0.14),
  ]).name = "天沟外挡边";
  hipRoof(g, x + w / 2, z + d / 2, w - 0.56, d - 0.56, base + 0.08, rise, mat);
  return g;
}

// 二楼两侧窗上的小披檐，外缘停在已有 70cm 前檐之内。
export function bayCanopy(
  parent: THREE.Object3D,
  x: number, z: number, w: number, d: number,
  base: number, rise: number, mat: Mats,
) {
  const g = new THREE.Group();
  g.name = "二楼披檐";
  parent.add(g);
  slab(g, rect(x, z, w, d), base - 0.06, 0.05, mat.dark);
  hipRoof(g, x + w / 2, z + d / 2, w - 0.08, d - 0.08, base, rise, mat);
  return g;
}

// 窗套贴在墙外皮之外，只加正面线脚。
export function openingFrame(
  parent: THREE.Object3D,
  x: number, sill: number, z: number,
  w: number, h: number, mat: Mats,
) {
  const t = 0.07, d = 0.04;
  box(parent, x, sill + h + t / 2, z, w + t * 2, t, d, mat.trim);
  box(parent, x, sill - t / 2, z, w + t * 2, t, d, mat.stone);
  box(parent, x - w / 2 - t / 2, sill + h / 2, z, t, h, d, mat.trim);
  box(parent, x + w / 2 + t / 2, sill + h / 2, z, t, h, d, mat.trim);
}

export function downpipe(
  parent: THREE.Object3D, x: number, z: number,
  gutterX: number, gutterZ: number, top: number, mat: Mats,
) {
  const pipe = new THREE.Group();
  pipe.name = "天沟落水管";
  parent.add(pipe);
  const a = new THREE.Vector3(gutterX, top + 0.02, gutterZ);
  const b = new THREE.Vector3(x, top - 0.28, z);
  const c = new THREE.Vector3(x, 0.16, z);
  cylinder(pipe, a, b, 0.055, mat.trim, 12);
  cylinder(pipe, b, c, 0.055, mat.trim, 12);
  for (let y = 0.8; y < top - 0.3; y += 1.8)
    box(pipe, x, y, z, 0.15, 0.055, 0.15, mat.stone);
}
