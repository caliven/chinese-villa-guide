import * as THREE from "three";
import type { OpeningKind } from "./openings";

export type DoorMaterials = {
  wood: THREE.Material; dark: THREE.Material; glass: THREE.Material;
  bronze?: THREE.Material; bronzeDark?: THREE.Material;
  doorTimber?: THREE.Material; doorInset?: THREE.Material;
  doorBathFrame?: THREE.Material; doorBathGlass?: THREE.Material;
  doorHardware?: THREE.Material; doorSeal?: THREE.Material;
  doorBronze?: THREE.Material; doorBronzeInset?: THREE.Material; doorBronzeHardware?: THREE.Material;
};
export type DoorSpec = {
  at: number; sill: number; w: number; h: number; kind?: OpeningKind;
  hinge?: "start" | "end"; side?: "in" | "out";
};
type DoorOptions = {
  style?: "timber" | "bronze" | "glazed" | "bathroom"; open?: boolean; frame?: boolean;
  thickness?: number; outward?: number; z?: number; bottom?: number; top?: number;
};

/** 门专用低对比竖向木纹，不改变家具、旧房及其他木构件的材质。 */
export function doorFinishMaterials() {
  const width = 128, height = 512, pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const bend = 2.8 * Math.sin(y / 83) + 1.2 * Math.sin(y / 31 + x / 44);
    const grain = Math.sin((x + bend) * .48) * .035 + Math.sin((x + bend) * 2.3) * .018;
    const figure = Math.sin(x * .09 + Math.sin(y / 137) * .6) * .055;
    const pore = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    const value = 1 + grain + figure + (pore - Math.floor(pore) - .5) * .025;
    const offset = (y * width + x) * 4;
    [167, 133, 98].forEach((tone, i) => pixels[offset + i] = Math.round(tone * value));
    pixels[offset + 3] = 255;
  }
  const map = new THREE.DataTexture(pixels, width, height);
  map.name = "室内门浅胡桃木竖向木纹";
  map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(1 / 900, 1 / 2400); map.anisotropy = 8;
  map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true; map.needsUpdate = true;
  return {
    doorBathFrame: new THREE.MeshStandardMaterial({ name: "浴室门深灰铝框", color: 0x414747, roughness: .4, metalness: .65 }),
    doorBathGlass: new THREE.MeshStandardMaterial({ name: "浴室门隐私雾面玻璃", color: 0xdce5df, roughness: .92, metalness: 0, transparent: false }),
    doorTimber: new THREE.MeshStandardMaterial({ name: "浅胡桃木门及门套", color: 0xffffff, map, roughness: .48 }),
    doorInset: new THREE.MeshStandardMaterial({ name: "木门凹入门芯", color: 0xeee7dc, map, roughness: .57 }),
    doorHardware: new THREE.MeshStandardMaterial({ name: "拉丝镍门五金", color: 0x92968f, roughness: .29, metalness: .78 }),
    doorSeal: new THREE.MeshStandardMaterial({ name: "门框密封条与阴缝", color: 0x282724, roughness: .95 }),
    doorBronze: new THREE.MeshStandardMaterial({ name: "咖色铸铝门边框", color: 0x876b54, roughness: .4, metalness: .48 }),
    doorBronzeInset: new THREE.MeshStandardMaterial({ name: "咖色铸铝门凹板", color: 0x705843, roughness: .48, metalness: .36 }),
    doorBronzeHardware: new THREE.MeshStandardMaterial({ name: "缎面古铜门五金", color: 0xad9070, roughness: .3, metalness: .7 }),
  };
}

/** 共用毫米实体。门扇原位裁切，剖看不会把高处五金下移或补出假门头。 */
export function doorModel(parent: THREE.Object3D, spec: DoorSpec, mat: DoorMaterials, options: DoorOptions = {}) {
  const group = new THREE.Group(); parent.add(group);
  const style = options.style ?? (spec.kind === "bathroomDoor" ? "bathroom" : spec.kind === "slidingDoor" ? "glazed" : "timber");
  group.name = style === "bathroom" ? "窄铝框雾面玻璃浴室门" : style === "bronze" ? "铸铝咖色大门" : style === "glazed" ? "双轨玻璃推拉门" : "实木造型室内门";
  group.position.set(spec.at, spec.sill, options.z ?? 0);
  group.userData.doorDimensions = { width: spec.w, height: spec.h, kind: spec.kind ?? "door", style };
  const bottom = (options.bottom ?? -Infinity) - spec.sill, top = (options.top ?? Infinity) - spec.sill;
  if (spec.kind === "passage" || top <= 0 || bottom >= spec.h || spec.w <= 0 || spec.h <= 0) return group;
  const timber = mat.doorTimber ?? mat.wood, seal = mat.doorSeal ?? mat.dark;
  const hardware = style === "bronze" ? mat.doorBronzeHardware ?? mat.bronze ?? mat.dark : mat.doorHardware ?? mat.dark;
  const finish = style === "bathroom" ? mat.doorBathFrame ?? mat.dark : style === "bronze" ? mat.doorBronze ?? mat.bronze ?? mat.dark : timber;
  const inset = style === "bronze" ? mat.doorBronzeInset ?? mat.bronzeDark ?? finish : mat.doorInset ?? timber;
  const thickness = options.thickness ?? 200, outward = options.outward ?? -1;

  const mesh = (target: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, name: string) => {
    geometry.computeBoundingBox();
    if (geometry.boundingBox!.max.y <= bottom || geometry.boundingBox!.min.y >= top) { geometry.dispose(); return; }
    // 曲面五金保持原有位置，只截掉剖切平面之外的三角形。
    if (geometry.boundingBox!.min.y < bottom || geometry.boundingBox!.max.y > top) {
      const source = geometry.index ? geometry.toNonIndexed() : geometry;
      const pos = source.getAttribute("position"), normal = source.getAttribute("normal"), uv = source.getAttribute("uv");
      type Vertex = { p: THREE.Vector3; n: THREE.Vector3; uv: THREE.Vector2 };
      const positions: number[] = [], normals: number[] = [], uvs: number[] = [];
      const clip = (vertices: Vertex[], bound: number, sign: number) => vertices.flatMap((a, i) => {
        const b = vertices[(i + 1) % vertices.length], da = (a.p.y - bound) * sign, db = (b.p.y - bound) * sign;
        const result = da >= 0 ? [a] : [];
        if (da < 0 && db > 0 || da > 0 && db < 0) {
          const t = da / (da - db);
          result.push({ p: a.p.clone().lerp(b.p, t), n: a.n.clone().lerp(b.n, t).normalize(), uv: a.uv.clone().lerp(b.uv, t) });
        }
        return result;
      });
      for (let i = 0; i < pos.count; i += 3) {
        let face = [0, 1, 2].map(j => ({ p: new THREE.Vector3().fromBufferAttribute(pos, i + j), n: new THREE.Vector3().fromBufferAttribute(normal, i + j), uv: new THREE.Vector2(uv.getX(i + j), uv.getY(i + j)) }));
        if (Number.isFinite(bottom)) face = clip(face, bottom, 1);
        if (Number.isFinite(top)) face = clip(face, top, -1);
        for (let j = 1; j < face.length - 1; j++) for (const v of [face[0], face[j], face[j + 1]]) {
          positions.push(...v.p.toArray()); normals.push(...v.n.toArray()); uvs.push(...v.uv.toArray());
        }
      }
      if (source !== geometry) source.dispose(); geometry.dispose();
      if (!positions.length) return;
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
      geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    }
    const object = new THREE.Mesh(geometry, material); object.name = name;
    object.castShadow = object.receiveShadow = material !== mat.glass; target.add(object); return object;
  };
  const piece = (target: THREE.Object3D, x: number, y: number, z: number, w: number, h: number, d: number, material: THREE.Material, name: string, bevel = 0) => {
    const lo = Math.max(bottom, y - h / 2), hi = Math.min(top, y + h / 2);
    if (w <= 0 || h <= 0 || d <= 0 || hi <= lo) return;
    let geometry: THREE.BufferGeometry;
    const r = Math.min(bevel, w / 4, h / 4, d / 4);
    if (r > 0 && lo === y - h / 2 && hi === y + h / 2) {
      const shape = new THREE.Shape(); shape.moveTo(-w / 2 + r, -h / 2 + r);
      shape.lineTo(w / 2 - r, -h / 2 + r); shape.lineTo(w / 2 - r, h / 2 - r);
      shape.lineTo(-w / 2 + r, h / 2 - r); shape.closePath();
      geometry = new THREE.ExtrudeGeometry(shape, { depth: d - 2 * r, bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: 2, steps: 1, curveSegments: 1 });
      geometry.translate(x, y, z - d / 2 + r);
    } else geometry = new THREE.BoxGeometry(w, hi - lo, d).translate(x, (lo + hi) / 2, z);
    if ((material as THREE.MeshStandardMaterial).map) {
      const pos = geometry.getAttribute("position"), normals = geometry.getAttribute("normal"), uv = geometry.getAttribute("uv");
      for (let i = 0; i < uv.count; i++) uv.setXY(i, Math.abs(normals.getX(i)) > .5 ? pos.getZ(i) : pos.getX(i), Math.abs(normals.getY(i)) > .5 ? pos.getZ(i) : pos.getY(i));
    }
    return mesh(target, geometry, material, name);
  };
  const rod = (target: THREE.Object3D, a: number[], b: number[], radius: number, material: THREE.Material, name: string) => {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), delta = end.clone().sub(start);
    const geometry = new THREE.CylinderGeometry(radius, radius, delta.length(), 12);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()));
    geometry.translate(...start.add(end).multiplyScalar(.5).toArray());
    return mesh(target, geometry, material, name);
  };
  const border = (target: THREE.Object3D, x: number, y: number, z: number, w: number, h: number, t: number, d: number, material: THREE.Material, name: string) => {
    for (const side of [-1, 1]) {
      piece(target, x + side * (w - t) / 2, y, z, t, h, d, material, name, 1.5);
      piece(target, x, y + side * (h - t) / 2, z, w - t * 2, t, d, material, name, 1.5);
    }
  };
  const pull = (target: THREE.Object3D, x: number, y: number, z: number, length: number, side: number) => {
    const clearance = style === "bronze" ? 44 : 32;
    const bend = Math.min(clearance, length / 3), front = z + side * clearance;
    const a = new THREE.Vector3(x, y - length / 2, z), b = new THREE.Vector3(x, y - length / 2 + bend, front);
    const c = new THREE.Vector3(x, y + length / 2 - bend, front), d = new THREE.Vector3(x, y + length / 2, z);
    const curve = new THREE.CurvePath<THREE.Vector3>();
    curve.add(new THREE.QuadraticBezierCurve3(a, new THREE.Vector3(x, a.y, front), b));
    curve.add(new THREE.LineCurve3(b, c));
    curve.add(new THREE.QuadraticBezierCurve3(c, new THREE.Vector3(x, d.y, front), d));
    mesh(target, new THREE.TubeGeometry(curve, 20, style === "bronze" ? 12 : 8, 10, false), hardware, "弯管门拉手");
    for (const sign of [-1, 1]) rod(target, [x, y + sign * length / 2, z - side * 3], [x, y + sign * length / 2, z + side * 5], 19, hardware, "拉手安装座");
  };

  const frame = options.frame !== false, sliding = style === "glazed";
  const jamb = frame ? Math.min(sliding ? 38 : 30, spec.w / 12) : 0;
  const head = frame ? sliding ? 65 : 35 : 0, gap = 3, floorGap = sliding ? 20 : 10;
  const x0 = -spec.w / 2 + jamb, x1 = spec.w / 2 - jamb;
  if (frame) {
    const material = sliding ? mat.dark : finish;
    for (const side of [-1, 1]) {
      piece(group, side * (spec.w - jamb) / 2, (spec.h - head) / 2, 0, jamb, spec.h - head, sliding ? 120 : thickness, material, "门框侧梃", 1.5);
      if (!sliding) for (const face of [-1, 1]) {
        piece(group, side * (spec.w / 2 + 8), spec.h / 2, face * (thickness / 2 + 8), 66, spec.h, 16, material, "双面门套线", 2);
      }
      piece(group, side * (spec.w / 2 - jamb - 5), (spec.h - head) / 2, 0, 10, spec.h - head, 18, seal, "门框密封条");
    }
    piece(group, 0, spec.h - head / 2, 0, spec.w, head, sliding ? 120 : thickness, material, "门框上梃", 1.5);
    if (!sliding) for (const face of [-1, 1]) piece(group, 0, spec.h + 8, face * (thickness / 2 + 8), spec.w + 82, 66, 16, material, "双面门套上横线", 2);
    if (style === "bronze") piece(group, 0, 7, 0, spec.w - 2 * jamb, 14, thickness - 10, hardware, "外门低门槛");
  }

  if (sliding) {
    for (const z of [-29, 29]) {
      piece(group, 0, 7, z, spec.w, 14, 8, hardware, "推拉门下轨");
      piece(group, 0, spec.h - 28, z, spec.w - 2 * jamb, 12, 10, seal, "推拉门上导轨");
    }
    const overlap = Math.min(65, spec.w * .04), width = (x1 - x0 + overlap) / 2, height = spec.h - head - floorGap;
    const stile = Math.min(46, width / 6), rail = 52, lowRail = 72;
    for (let i = 0; i < 2; i++) {
      const leaf = new THREE.Group(); leaf.name = "错层推拉门扇"; group.add(leaf);
      const x = i ? x1 - width / 2 : x0 + width / 2, z = (i ? 29 : -29) * outward;
      for (const sign of [-1, 1]) piece(leaf, x + sign * (width - stile) / 2, floorGap + height / 2, z, stile, height, 42, mat.dark, "推拉门扇竖框", 1.5);
      piece(leaf, x, floorGap + height - rail / 2, z, width - 2 * stile, rail, 42, mat.dark, "推拉门扇上横框", 1.5);
      piece(leaf, x, floorGap + lowRail / 2, z, width - 2 * stile, lowRail, 42, mat.dark, "推拉门扇下横框", 1.5);
      const glassW = width - 2 * stile, glassH = height - rail - lowRail, glassY = floorGap + lowRail + glassH / 2;
      piece(leaf, x, glassY, z, glassW, glassH, 18, mat.glass, "推拉门独立玻璃");
      for (const side of [-1, 1]) {
        border(leaf, x, glassY, z + side * 11, glassW + 6, glassH + 6, 5, 4, seal, "推拉门玻璃密封条");
        border(leaf, x, glassY, z + side * 16, glassW + 20, glassH + 20, 10, 8, mat.dark, "推拉门玻璃压条");
        const handleX = x + (i ? -1 : 1) * (width / 2 - stile / 2);
        if (side === Math.sign(z)) pull(leaf, handleX, Math.min(1050, spec.h / 2), z + side * 23, Math.min(240, spec.h / 5), side);
        else piece(leaf, handleX, Math.min(1050, spec.h / 2), z + side * 22, 23, 150, 3, hardware, "推拉门内嵌扣手", 1);
      }
      piece(leaf, x + (i ? -1 : 1) * (width / 2 - 3), floorGap + height / 2, z, 6, height, 48, seal, "推拉门交接毛条");
    }
    return group;
  }

  const double = spec.kind === "doubleDoor", count = double ? 2 : 1;
  const leafW = (x1 - x0 - 2 * gap - (double ? gap : 0)) / count;
  const leafH = spec.h - head - floorGap - gap, depth = style === "bronze" ? 70 : 42;
  const open = options.open ?? (style === "timber" || style === "bathroom"), openSide = spec.side === "in" ? -1 : 1;
  if (double && !open) piece(group, 0, floorGap + leafH / 2, -outward * (depth / 2 - 3), 8, leafH, 6, seal, "双扇中缝密封条");
  for (let i = 0; i < count; i++) {
    const end = double ? i === 1 : spec.hinge === "end", direction = end ? -1 : 1;
    const leaf = new THREE.Group(); group.add(leaf); leaf.name = "平开门扇";
    leaf.position.set(end ? x1 - gap : x0 + gap, 0, open ? openSide * (thickness / 2 - depth / 2) : 0);
    leaf.rotation.y = open ? -direction * openSide * Math.PI / 2 : 0;
    leaf.userData.doorHinge = end ? "end" : "start";
    const cx = direction * leafW / 2, cy = floorGap + leafH / 2;
    if (style === "bathroom") {
      const stile = Math.min(38, leafW / 6), rail = 45, lowRail = 90;
      for (const sign of [-1, 1]) piece(leaf, cx + sign * (leafW - stile) / 2, cy, 0, stile, leafH, depth, finish, "浴室门窄边竖框", 2);
      piece(leaf, cx, floorGap + leafH - rail / 2, 0, leafW - 2 * stile, rail, depth, finish, "浴室门上横框", 2);
      piece(leaf, cx, floorGap + lowRail / 2, 0, leafW - 2 * stile, lowRail, depth, finish, "浴室门防潮下横框", 2);
      const gw = leafW - 2 * stile, gh = leafH - rail - lowRail, gy = floorGap + lowRail + gh / 2;
      piece(leaf, cx, gy, 0, gw, gh, 8, mat.doorBathGlass ?? mat.glass, "浴室门整片雾面玻璃");
      for (const face of [-1, 1]) border(leaf, cx, gy, face * 7, gw + 6, gh + 6, 6, 6, seal, "浴室门玻璃密封压条");
    } else {
      const stile = Math.min(style === "bronze" ? 95 : 85, leafW / 5), topRail = 100, bottomRail = style === "bronze" ? 170 : 140;
      piece(leaf, cx, cy, 0, leafW, leafH, depth - 10, finish, "门扇基板", 2);
      for (const sign of [-1, 1]) piece(leaf, cx + sign * (leafW - stile) / 2, cy, 0, stile, leafH, depth, finish, "门扇边梃", 2);
      piece(leaf, cx, spec.h - head - gap - topRail / 2, 0, leafW - 2 * stile, topRail, depth, finish, "门扇上横档", 2);
      piece(leaf, cx, floorGap + bottomRail / 2, 0, leafW - 2 * stile, bottomRail, depth, finish, "门扇下横档", 2);
      const mid = floorGap + leafH * .29, midRail = style === "bronze" ? 80 : 75;
      piece(leaf, cx, mid, 0, leafW - 2 * stile, midRail, depth, finish, "门扇中横档", 2);
      for (const [lo, hi] of [[floorGap + bottomRail, mid - midRail / 2], [mid + midRail / 2, spec.h - head - gap - topRail]]) {
        const w = leafW - 2 * stile - 5, h = hi - lo - 5, y = (lo + hi) / 2;
        if (w <= 16 || h <= 16) continue;
        for (const face of [-1, 1]) {
          piece(leaf, cx, y, face * (depth / 2 - 7), w, h, 8, inset, "凹入门芯", 1.5);
          border(leaf, cx, y, face * (depth / 2 + 1), w + 4, h + 4, 12, 8, finish, "门芯倒角压线");
          if (style === "bronze") border(leaf, cx, y, face * (depth / 2 - 1), w - 26, h - 26, 5, 4, finish, "咖色门芯内线");
        }
      }
    }
    for (const fraction of [.16, .5, .84]) {
      const y = floorGap + leafH * fraction, x = direction * 3;
      rod(leaf, [x, y - 40, 0], [x, y + 40, 0], 8, hardware, "门扇三节铰链");
      for (const offset of [-22, 22]) rod(leaf, [x, y + offset - 1.5, 0], [x, y + offset + 1.5, 0], 9, seal, "铰链分节缝");
    }
    const handleX = direction * (leafW - Math.min(65, leafW / 5)), handleY = Math.min(1050, spec.h * .48);
    for (const face of [-1, 1]) {
      const z = face * (depth / 2 + 4);
      if (style === "bronze") pull(leaf, handleX, Math.min(spec.h * .49, 1250), z, Math.min(650, leafH * .27), face);
      else {
        rod(leaf, [handleX, handleY, z - face * 2], [handleX, handleY, z + face * 6], 24, hardware, "门执手圆底座");
        rod(leaf, [handleX, handleY, z + face * 6], [handleX, handleY, z + face * 42], 8, hardware, "门执手支颈");
        rod(leaf, [handleX, handleY, z + face * 42], [handleX - direction * 105, handleY, z + face * 42], 8, hardware, "门执手横柄");
        for (const offset of [-16, 16]) rod(leaf, [handleX + offset, handleY, z + face * 6], [handleX + offset, handleY, z + face * 7], 2.5, seal, "执手固定螺钉");
      }
      if (style === "bathroom") {
        rod(leaf, [handleX, handleY - 90, z], [handleX, handleY - 90, z + face * 8], 20, hardware, "浴室门隐私锁底座");
        piece(leaf, handleX, handleY - 90, z + face * 12, face === -1 ? 28 : 3, 8, 8, hardware, face === -1 ? "浴室门内侧旋钮" : "浴室门外侧应急槽", 1);
        continue;
      }
      rod(leaf, [handleX, handleY - 140, z], [handleX, handleY - 140, z + face * 5], 17, hardware, "门锁锁孔盖");
      rod(leaf, [handleX, handleY - 138, z + face * 5], [handleX, handleY - 138, z + face * 6], 4, seal, "门锁钥匙孔");
      piece(leaf, handleX, handleY - 144, z + face * 6, 3, 9, 1, seal, "门锁钥匙槽");
    }
    piece(leaf, direction * (leafW + 1), handleY, 0, 2, 150, depth - 12, hardware, "门扇侧面锁舌面板");
  }
  return group;
}
