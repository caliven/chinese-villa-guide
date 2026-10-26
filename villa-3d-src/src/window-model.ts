import * as THREE from "three";
import { windowProfiles, type WindowDesign, type WindowRect } from "./window-design";

const unitBox = new THREE.BoxGeometry(1, 1, 1);
type WindowMaterials = { glass: THREE.Material; dark: THREE.Material };
type WindowModelOptions = { intoRoom?: number; bottom?: number; top?: number; paneName?: string; framePrefix?: string };

/** 框、扇、压条和独立中空玻璃均使用毫米实体；裁切不改变原窗的分格。 */
export function windowModel(parent: THREE.Object3D, design: WindowDesign, mat: WindowMaterials, options: WindowModelOptions = {}) {
  const group = new THREE.Group(); parent.add(group); group.name = "尺寸自适应窗";
  group.userData.windowDimensions = { width: design.width, height: design.height, mode: design.mode };
  const { intoRoom = 1, bottom = -Infinity, top = Infinity, paneName = "窗分格玻璃", framePrefix = "窗" } = options;
  const piece = (r: WindowRect, name: string, material: THREE.Material, depth: number, z: number) => {
    const lo = Math.max(bottom, r.y), hi = Math.min(top, r.y + r.h);
    if (hi <= lo || r.w <= 0) return;
    const mesh = new THREE.Mesh(unitBox, material);
    mesh.position.set(r.x + r.w / 2, (lo + hi) / 2, z); mesh.scale.set(r.w, hi - lo, depth);
    mesh.name = name; mesh.castShadow = material !== mat.glass; mesh.receiveShadow = material !== mat.glass;
    group.add(mesh); return mesh;
  };
  const border = (r: WindowRect, thickness: number, name: string, depth: number, z: number) => {
    const t = Math.min(thickness, r.w / 6, r.h / 6);
    piece({ x: r.x - t, y: r.y - t, w: t, h: r.h + 2 * t }, name, mat.dark, depth, z);
    piece({ x: r.x + r.w, y: r.y - t, w: t, h: r.h + 2 * t }, name, mat.dark, depth, z);
    piece({ x: r.x, y: r.y - t, w: r.w, h: t }, name, mat.dark, depth, z);
    piece({ x: r.x, y: r.y + r.h, w: r.w, h: t }, name, mat.dark, depth, z);
  };
  design.frames.forEach(f => piece(f, `${framePrefix}${f.role}`, mat.dark, f.role === "密封胶条" ? 16 : f.role === "开启扇框" ? windowProfiles.sashDepth : windowProfiles.frameDepth, f.role === "开启扇框" ? -intoRoom * 5 : 0));
  design.panes.forEach(p => {
    const mesh = piece(p, paneName, mat.glass, windowProfiles.glassDepth, intoRoom * 8);
    if (mesh) mesh.userData.glazingCell = { row: p.row, column: p.column, operable: p.operable };
    // 压条在玻璃槽上，内外两侧错层，近看可辨固定框与活动扇的接缝。
    for (const sign of [-1, 1]) border(p, windowProfiles.bead, "玻璃压条", 10, sign * 43);
  });
  design.windows.forEach(w => {
    const handleY = w.y + Math.min(500, w.h / 2), handleX = w.hinge === "left" ? w.x + w.w - 20 : w.x + 20;
    if (w.hinge === "top") {
      piece({ x: w.x + w.w / 2 - 55, y: w.y + 10, w: 110, h: 16 }, "上悬窗执手", mat.dark, 28, intoRoom * 58);
    } else {
      piece({ x: handleX - 11, y: handleY - 24, w: 22, h: 48 }, "窗执手底座", mat.dark, 12, intoRoom * 48);
      piece({ x: handleX - 8, y: handleY - 95, w: 16, h: 110 }, "可开启窗执手", mat.dark, 28, intoRoom * 62);
      for (const at of [.2, .8]) piece({ x: w.hinge === "left" ? w.x + 4 : w.x + w.w - 20, y: w.y + w.h * at - 32, w: 16, h: 64 }, "可开启窗铰链", mat.dark, 20, intoRoom * 46);
    }
  });
  return group;
}
