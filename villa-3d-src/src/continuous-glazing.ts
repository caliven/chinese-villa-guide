import * as THREE from "three";
import type { ContinuousGlazing } from "./facade-layout";
import { site } from "./data";
import { moveWindowDesign, windowDesign } from "./window-design";
import { windowModel } from "./window-model";

/** 通高窗按实际宽高排固定玻璃与下部开启扇；不再把窄窗硬分成九宫格。 */
export function continuousGlazingGrid(panel: ContinuousGlazing) {
  return moveWindowDesign(windowDesign(panel.w, panel.top - panel.bottom, "continuous", 70), panel.at - panel.w / 2, panel.bottom);
}

export function continuousGlazing(parent: THREE.Object3D, panel: ContinuousGlazing, glass: THREE.Material, frame: THREE.Material, bottom = panel.bottom, top = panel.top) {
  const dx = panel.b[0] - panel.a[0], dz = panel.b[1] - panel.a[1], len = Math.hypot(dx, dz);
  const midX = (panel.a[0] + panel.b[0]) / 2, midZ = (panel.a[1] + panel.b[1]) / 2;
  const intoRoom = ((site.main.x + site.main.w / 2 - midX) * -dz + (site.main.z + site.main.d / 2 - midZ) * dx) / len > 0 ? 1 : -1;
  const group = windowModel(parent, moveWindowDesign(continuousGlazingGrid(panel), 0, -bottom), { glass, dark: frame },
    { intoRoom, bottom: 0, top: top - bottom, paneName: "通高玻璃分格板块", framePrefix: "通高玻璃" });
  group.name = "挑空客厅通高玻璃";
  group.userData.continuousGlazing = panel.id;
  group.position.set(panel.a[0], bottom, panel.a[1]); group.rotation.y = -Math.atan2(dz, dx);
  return group;
}
