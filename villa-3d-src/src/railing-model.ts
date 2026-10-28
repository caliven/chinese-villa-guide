import * as THREE from "three";
import { canonicalRailingStyle, railingStyleLabels, type RailingStyle } from "./railing-options";
import type { RailingJoints, RailingEndJoint } from "./railing-network";
import { handrailGeometry, type HandrailSample } from "./railing-handrail";

function marbleTexture() {
  const size = 64, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const vein = Math.exp(-Math.abs(Math.sin(x * .13 + y * .07 + Math.sin(y * .16) * .7)) * 22);
    const tone = 246 - vein * 32 - (Math.sin(x * 1.7 + y * 2.3) + 1) * 2;
    const i = (y * size + x) * 4;
    pixels[i] = tone; pixels[i + 1] = tone - 2; pixels[i + 2] = tone - 6; pixels[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** 同时表达水平护栏及斜梯护栏；端点为扶手竖直投影的底标高，单位 mm。 */
export function railingModel(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, style: RailingStyle, height = 1100, footing?: { t: number; y: number }[], joints: RailingJoints = {}, startHeight = height, endHeight = height, handrailPath?: HandrailSample[]) {
  style = canonicalRailingStyle(style);
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  if (length < 1) return new THREE.Group();
  const group = new THREE.Group();
  group.name = `室内栏杆 · ${railingStyleLabels[style]}`;
  group.userData.railingStyle = style;
  group.userData.railingEndpoints = [a.toArray(), b.toArray()];
  group.userData.railingJoins = joints;
  group.position.copy(a); group.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
  parent.add(group);
  const delta = b.y - a.y;
  const metal = new THREE.MeshStandardMaterial({ color: style === "glass" ? "#65716f" : "#303837", metalness: .72, roughness: .3 });
  const wood = new THREE.MeshStandardMaterial({ color: "#865632", roughness: .66 });
  const stone = new THREE.MeshStandardMaterial({ color: style === "marble" ? "#f4f0e8" : "#d8cdb8", roughness: style === "marble" ? .35 : .75,
    map: style === "marble" ? marbleTexture() : null });
  const glass = new THREE.MeshStandardMaterial({ color: "#b1d4d3", transparent: true, opacity: .28, depthWrite: false, roughness: .13, metalness: .08, side: THREE.DoubleSide });
  const material = style === "wood" ? wood : metal;
  const startOffset = (joints.start?.top ?? a.y + startHeight) - a.y - height;
  const endOffset = (joints.end?.top ?? b.y + endHeight) - a.y - height;
  const bottom = (x: number) => startOffset + (endOffset - startOffset) * x / length;
  const along = new THREE.Vector3((b.x - a.x) / length, 0, (b.z - a.z) / length);
  const side = new THREE.Vector3(-along.z, 0, along.x);
  const local = (p: THREE.Vector3, position: boolean) => {
    const value = position ? p.clone().sub(a) : p;
    return new THREE.Vector3(value.dot(along), value.y, value.dot(side));
  };
  const railPath = handrailPath?.map(sample => ({ point: local(sample.point, true), tangent: local(sample.tangent, false) }))
    ?? [0, length].map(x => ({ point: new THREE.Vector3(x, bottom(x) + height, 0), tangent: new THREE.Vector3(length, endOffset - startOffset, 0).normalize() }));
  const support = (x: number) => footing?.filter(p => p.t <= x / length + 1e-8).at(-1)?.y ?? a.y + delta * x / length;
  const supportLocal = (x: number) => support(x) - a.y;
  const lowerRail = footing ? 220 : 100;
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, name: string) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name;
    mesh.castShadow = material !== glass; mesh.receiveShadow = true; group.add(mesh); return mesh;
  };
  const box = (x: number, y: number, w: number, h: number, d: number, mat: THREE.Material, name: string) => {
    const mesh = add(new THREE.BoxGeometry(w, h, d), mat, name); mesh.position.set(x, y, 0); return mesh;
  };
  const handrail = (w: number, h: number, r: number, top: number, mat: THREE.Material, name: string) =>
    add(handrailGeometry(railPath, w, h, r, top, !joints.start, !joints.end), mat, name);
  // 两段在公共节点使用完全相同的斜接截面，既不叠加直角端块，也不留三角空隙。
  const section = (x0: number, x1: number, outline: number[][], mat: THREE.Material, name: string) => {
    const shape = new THREE.Shape();
    outline.forEach(([z, y], i) => i === 0 ? shape.moveTo(-z, y) : shape.lineTo(-z, y));
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: x1 - x0, bevelEnabled: false, steps: 1 });
    geometry.rotateY(Math.PI / 2); geometry.translate(x0, 0, 0);
    const frame = (joint?: RailingEndJoint) => joint ? new THREE.Vector3(
      ((b.x - a.x) * joint.miter.x + (b.z - a.z) * joint.miter.z) / length,
      joint.miter.y, (-(b.z - a.z) * joint.miter.x + (b.x - a.x) * joint.miter.z) / length,
    ) : new THREE.Vector3(0, 0, 1);
    const first = frame(Math.abs(x0) < .01 ? joints.start : undefined), last = frame(Math.abs(x1 - length) < .01 ? joints.end : undefined);
    const vertices = geometry.getAttribute("position");
    for (let i = 0; i < vertices.count; i++) {
      const x = vertices.getX(i), y = vertices.getY(i), z = vertices.getZ(i), t = (x - x0) / (x1 - x0);
      const miter = first.clone().lerp(last, t);
      vertices.setXYZ(i, x + miter.x * z, y + bottom(x) + miter.y * z, miter.z * z);
    }
    geometry.computeVertexNormals();
    return add(geometry, mat, name);
  };
  // 梯段立柱保持竖直；扶手截面按路径坡度和公共转角生成。
  const panel = (x0: number, x1: number, low: number, high: number, depth: number, mat: THREE.Material, name: string) => {
    if (x1 - x0 < 1 || high - low < 1) return;
    return section(x0, x1, [[-depth / 2, low], [depth / 2, low], [depth / 2, high], [-depth / 2, high]], mat, name);
  };
  if (style === "marble") {
    // 柱身竖直落到踏步，柱头上缘按扶手坡度收口；柱间不生成墙板。
    const upright = (x: number, width: number, base: number, topOffset: number, depth: number, mat: THREE.Material, name: string) => {
      const left = x - width / 2, right = x + width / 2;
      const shape = new THREE.Shape();
      shape.moveTo(left, base); shape.lineTo(right, base);
      shape.lineTo(right, bottom(right) + topOffset); shape.lineTo(left, bottom(left) + topOffset); shape.closePath();
      const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 });
      geometry.translate(0, 0, -depth / 2); return add(geometry, mat, name);
    };
    // 直段连续排小瓶柱，只在两端收口；不再每隔 1800 插一根粗方墩。
    const capWidth = joints.start && joints.end ? 150 : Math.min(150, length / 2), postWidth = capWidth * 11 / 15;
    const posts = [joints.start ? 0 : capWidth / 2, joints.end ? length : length - capWidth / 2];
    for (const [index, x] of posts.entries()) {
      const joint = index === 0 ? joints.start : joints.end;
      if (joint && !joint.post) continue;
      const foot = joint ? joint.base - a.y : supportLocal(x);
      box(x, foot + 25, capWidth - 10, 50, capWidth - 10, stone, "主柱柱脚");
      upright(x, postWidth, foot + 50, height - 95, postWidth, stone, "大理石主柱");
      if (joint) box(x, bottom(x) + height - 81.5, capWidth, 27, capWidth, stone, "主柱柱头");
      else panel(x - capWidth / 2, x + capWidth / 2, height - 95, height - 68, capWidth, stone, "主柱柱头");
    }
    // 细颈、下部微鼓的花瓶柱；平滑曲线与圆周细分避免折面像竹节。
    const profile = [[0, .60], [.03, .78], [.07, .78], [.11, .50], [.18, .63], [.28, .91],
      [.37, 1], [.46, .93], [.59, .68], [.73, .43], [.81, .41], [.86, .61], [.90, .68], [.94, .53], [1, .60]];
    const curve = new THREE.SplineCurve(profile.map(([y, radius]) => new THREE.Vector2(radius, y)));
    const spindleProfile = curve.getPoints(64);
    for (let i = 1; i < posts.length; i++) {
      const left = posts[i - 1] + (joints.start && !joints.start.hasPost ? 0 : postWidth / 2);
      const right = posts[i] - (joints.end && !joints.end.hasPost ? 0 : postWidth / 2), clear = right - left;
      const count = clear < 180 ? 0 : Math.ceil((clear - 80) / 170), gap = (clear - count * 84) / (count + 1);
      for (let j = 0; j < count; j++) {
        const x = left + gap + 42 + j * (84 + gap), foot = supportLocal(x);
        const top = bottom(x) + height - 86 - Math.abs(delta / length) * 38;
        const shaftHeight = top - foot - 50;
        box(x, foot + 25, 100, 50, 100, stone, "栏杆柱底座");
        const geometry = new THREE.LatheGeometry(spindleProfile.map(p => new THREE.Vector2(Math.min(1, p.x) * 42, p.y * shaftHeight)), 24);
        const column = add(geometry, stone, "花瓶栏杆柱"); column.position.set(x, foot + 50, 0);
        upright(x, 76, top - 8, height - 68, 76, stone, "栏杆柱柱头");
      }
    }
    handrail(110, 18, 4, -50, stone, "扶手下沿线");
    handrail(140, 50, 8, 0, stone, "连续石材扶手");
    if (!footing && Math.abs(delta) < 1) panel(0, length, 0, 45, 110, stone, "石质下横梁");
    return group;
  }
  const postWidth = style === "wood" ? 80 : 45;
  const bays = Math.max(1, Math.ceil(length / (style === "wood" ? 1500 : 1200)));
  const postAt = (i: number) => i === 0 && joints.start ? 0 : i === bays && joints.end ? length : postWidth / 2 + (length - postWidth) * i / bays;
  for (let i = 0; i <= bays; i++) {
    const joint = i === 0 ? joints.start : i === bays ? joints.end : undefined;
    if (joint && !joint.post) continue;
    const x = postAt(i);
    const foot = joint ? joint.base - a.y : supportLocal(x), top = bottom(x) + height - 55;
    box(x, (foot + top) / 2, postWidth, top - foot, postWidth, material, "主立柱");
    box(x, foot + 8, postWidth + 20, 16, postWidth + 20, material, "柱脚");
    if (style === "wood") box(x, bottom(x) + height - 90, 96, 35, 96, wood, "木柱柱头");
  }
  handrail(style === "wood" ? 90 : 55, 55, style === "wood" ? 8 : 10, 0, material, "连续扶手");
  if (style === "glass") {
    for (let i = 0; i < bays; i++) {
      const left = postWidth + (length - postWidth) * i / bays + 12;
      const right = (length - postWidth) * (i + 1) / bays - 12;
      panel(left, right, lowerRail, height - 90, 16, glass, "独立玻璃片");
      for (const x of [left, right]) for (const y of [220, height - 220])
        box(x, bottom(x) + y, 24, 36, 30, metal, "玻璃夹件");
    }
  } else {
    panel(0, length, lowerRail - 35, lowerRail, style === "wood" ? 60 : 28, material, "下横档");
    const width = style === "wood" ? 34 : 18;
    const count = Math.max(1, Math.ceil(length / (style === "wood" ? 115 : 105)));
    for (let i = 1; i < count; i++) {
      const x = length * i / count;
      if (Array.from({ length: bays + 1 }, (_, j) => postAt(j)).some(p => Math.abs(x - p) < (postWidth + width) / 2 + 5)) continue;
      box(x, bottom(x) + (lowerRail + height - 55) / 2, width, height - 55 - lowerRail, width, material, "竖向栏条");
    }
  }
  return group;
}
