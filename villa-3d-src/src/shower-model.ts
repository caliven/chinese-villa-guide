import * as THREE from "three";
import type { Furniture } from "./data";

export const showerShapes = {
  inline: "一字型（三面靠墙）",
  corner: "方形转角（两面靠墙）",
  quadrant: "扇弧转角（两面靠墙）",
} as const;
export type ShowerShape = keyof typeof showerShapes;
export const isShower = (f: Furniture) => f.kind === "shower" || f.kind === "fp-shower";

/** 本地毫米几何，后方+Z为花洒墙；靠墙侧不额外生成玻璃或实体墙。 */
export function showerOutline(f: Furniture): THREE.Vector2[] {
  const w = f.w, d = f.d, shape = f.showerShape ?? "inline";
  if (shape === "quadrant") {
    const flip = f.showerDoorSide === "right" ? -1 : 1;
    return [new THREE.Vector2(flip * w / 2, d / 2), ...Array.from({ length: 33 }, (_, i) => {
      const t = Math.PI / 2 * i / 32;
      return new THREE.Vector2(flip * (w / 2 - w * Math.cos(t)), d / 2 - d * Math.sin(t));
    })];
  }
  return [new THREE.Vector2(-w / 2, -d / 2), new THREE.Vector2(w / 2, -d / 2), new THREE.Vector2(w / 2, d / 2), new THREE.Vector2(-w / 2, d / 2)];
}

export function showerModel(f: Furniture, glass?: THREE.Material) {
  const g = new THREE.Group(); g.name = "推拉门淋浴房";
  const shape = f.showerShape ?? "inline", opening = (f.showerOpening ?? 0) / 100;
  const metal = new THREE.MeshStandardMaterial({ color: 0x777f80, metalness: .8, roughness: .28 });
  const paneMat = glass ? glass.clone() : new THREE.MeshStandardMaterial({ color: 0xc9dfd7, transparent: true, opacity: .3, roughness: .12 });
  paneMat.side = THREE.DoubleSide;
  const trayMat = new THREE.MeshStandardMaterial({ color: 0xeeeae2, roughness: .5 });
  const outline = showerOutline(f);
  const footprint = new THREE.Shape(outline);
  const tray = new THREE.ExtrudeGeometry(footprint, { depth: 40, bevelEnabled: false });
  tray.rotateX(Math.PI / 2); tray.translate(0, 40, 0);
  const base = new THREE.Mesh(tray, trayMat); base.name = "淋浴房底盘"; g.add(base);
  const rod = (a: THREE.Vector3, b: THREE.Vector3, radius: number, name: string) => {
    const delta = b.clone().sub(a), mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, delta.length(), 10), metal);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    mesh.position.copy(a).add(b).multiplyScalar(.5); mesh.name = name; g.add(mesh);
  };
  type Path = (t: number, offset?: number) => THREE.Vector2;
  const segment = (a: THREE.Vector2, b: THREE.Vector2): Path => (t, offset = 0) => {
    const p = a.clone().lerp(b, t), v = b.clone().sub(a).normalize();
    return p.add(new THREE.Vector2(-v.y, v.x).multiplyScalar(offset));
  };
  const curve: Path = (t, offset = 0) => {
    const arc = Math.PI / 2;
    const flip = shape === "quadrant" && f.showerDoorSide === "right" ? -1 : 1;
    const cx = f.w / 2 - 18;
    return new THREE.Vector2(flip * (cx - (f.w - 36 - offset) * Math.cos(t * arc)), f.d / 2 - 18 - (f.d - 36 - offset) * Math.sin(t * arc));
  };
  const panel = (path: Path, a: number, b: number, offset: number, moving: boolean) => {
    const count = shape === "quadrant" ? 24 : 1;
    const points: number[] = [], indices: number[] = [];
    for (let i = 0; i <= count; i++) {
      const p = path(a + (b - a) * i / count, offset);
      points.push(p.x, 70, p.y, p.x, 1960, p.y);
      if (i < count) { const n = i * 2; indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2); }
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, paneMat); mesh.name = moving ? "推拉活动玻璃" : "固定玻璃"; g.add(mesh);
    for (const t of [a, b]) { const p = path(t, offset); rod(new THREE.Vector3(p.x, 65, p.y), new THREE.Vector3(p.x, 1970, p.y), 5, "玻璃竖边密封条"); }
    if (moving) {
      const t = a < .5 ? b - .035 : a + .035, p = path(t, offset + 25);
      rod(new THREE.Vector3(p.x, 900, p.y), new THREE.Vector3(p.x, 1150, p.y), 8, "移门拉手");
      for (const t of [a + .035, b - .035]) { const p = path(t, offset); rod(new THREE.Vector3(p.x, 1955, p.y), new THREE.Vector3(p.x, 1985, p.y), 14, "移门滑轮"); }
    }
  };
  const screen = (path: Path, sliding: boolean) => {
    for (const y of [55, 1990]) {
      const pts = Array.from({ length: 49 }, (_, i) => { const p = path(i / 48); return new THREE.Vector3(p.x, y, p.y); });
      const rail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, y === 55 ? 8 : 16, 8, false), metal); rail.name = "推拉门连续导轨"; g.add(rail);
    }
    if (!sliding) { panel(path, 0, 1, 0, false); return; }
    panel(path, 0, .25, 0, false); panel(path, .75, 1, 0, false);
    panel(path, .24 - .23 * opening, .505 - .23 * opening, 18, true);
    panel(path, .495 + .23 * opening, .76 + .23 * opening, 18, true);
  };
  const front = segment(new THREE.Vector2(-f.w / 2 + 18, -f.d / 2 + 18), new THREE.Vector2(f.w / 2 - 18, -f.d / 2 + 18));
  const side = f.showerDoorSide ?? "front";
  const sidePath = segment(new THREE.Vector2((side === "right" ? 1 : -1) * (f.w / 2 - 18), -f.d / 2 + 18), new THREE.Vector2((side === "right" ? 1 : -1) * (f.w / 2 - 18), f.d / 2 - 18));
  const inwardSide: Path = side === "right" ? sidePath : (t, offset) => sidePath(1 - t, -(offset ?? 0));
  if (shape === "quadrant") screen(curve, true);
  else if (shape === "corner") { screen(front, side === "front"); screen(inwardSide, side !== "front"); }
  else screen(side === "front" ? front : inwardSide, true);
  const x = 0, z = f.d / 2 - 35;
  rod(new THREE.Vector3(x, 1000, z), new THREE.Vector3(x, 1900, z), 12, "花洒升降杆");
  rod(new THREE.Vector3(x, 1900, z), new THREE.Vector3(x, 2030, z - 180), 10, "花洒弯管");
  const head = new THREE.Mesh(new THREE.CylinderGeometry(95, 95, 12, 24), metal); head.position.set(x, 2025, z - 180); head.name = "花洒顶喷"; g.add(head);
  rod(new THREE.Vector3(-65, 1050, z), new THREE.Vector3(65, 1050, z), 24, "花洒混水阀");
  const drain = new THREE.Mesh(new THREE.BoxGeometry(160, 4, 50), metal); drain.position.set(0, 43, f.d / 2 - 90); drain.name = "淋浴地漏"; g.add(drain);
  return g;
}

export function showerSymbol(f: Furniture, pick = "") {
  const points = showerOutline(f).map(p => `${p.x},${p.y}`).join(" ");
  const front = f.showerShape === "quadrant";
  const side = f.showerDoorSide ?? "front";
  const arrow = front || side === "front" ? `M${-f.w * .18} ${-f.d * .3}h${f.w * .36}m-35 -25l35 25-35 25` : `M${(side === "right" ? 1 : -1) * f.w * .3} ${-f.d * .18}v${f.d * .36}m-25 -35l25 35 25-35`;
  return `<g class="furniture ${f.kind}"${pick}><polygon class="floorplan-furniture-shape"${pick} points="${points}" fill="#e4edf2" stroke="#778b8b" stroke-width="12"/><path d="${arrow}" fill="none" stroke="#718886" stroke-width="12"/><circle cx="0" cy="${f.d / 2 - 80}" r="35" fill="#fff" stroke="#718886" stroke-width="10"/></g>`;
}
