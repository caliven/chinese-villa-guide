import * as THREE from "three";
import { roofHeight, type RoofFace, type RoofRidge } from "./roof-surfaces";
import { roofGutterDesign, roofTileThickness } from "./roof-options";

/** 农村四坡木屋盖示意尺寸（毫米）；仅为外观表达，非结构验算截面。 */
const ridgeSection = { w: 200, d: 240 };
const hipSection = { w: 160, d: 200 };
const purlinSection = { w: 120, d: 160 };
const rafterSection = { w: 60, d: 100 };
/** 梁心下移量：瓦厚＋截面半高＋空隙，保证梁顶在瓦底之下。 */
const frameDrop = (depth: number) => roofTileThickness + depth / 2 + 50;
/**
 * 瓦边探入天沟后，内挡水泥墙仍在瓦下。木梁须从瓦边再往里收到内挡内皮以内，
 * 否则斜脊梁／檐檩截面会穿进天沟内挡（水泥区），鸟瞰像木头顶到沟里。
 */
const clearGutterInner = (sectionW: number) =>
  roofGutterDesign.tileOverhang + sectionW / 2 + 40;
/** 沿水平斜脊：两边各收 clear，斜向长度 = clear × √2。 */
const hipEaveInset = (sectionW: number) => clearGutterInner(sectionW) * Math.SQRT2;
/** 檩条沿檐口两端离开斜脊／瓦角。 */
const spanEndInset = (sectionW: number) => sectionW / 2 + 40;

function faceNormal(face: RoofFace) {
  const a = face.points[0];
  let n = new THREE.Vector3();
  for (let i = 1; i < face.points.length - 1; i++) {
    n = face.points[i].clone().sub(a).cross(face.points[i + 1].clone().sub(a));
    if (n.lengthSq() > 1) break;
  }
  if (n.y < 0) n.negate();
  return n.normalize();
}

function timberBeam(
  parent: THREE.Object3D,
  a: THREE.Vector3,
  b: THREE.Vector3,
  width: number,
  depth: number,
  material: THREE.Material,
  drop: number,
  name: string,
) {
  const dir = b.clone().sub(a);
  const length = dir.length();
  if (length < 80) return;
  dir.normalize();
  const hint = Math.abs(dir.y) < 0.92 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const side = new THREE.Vector3().crossVectors(dir, hint).normalize();
  const normal = new THREE.Vector3().crossVectors(side, dir).normalize();
  if (normal.y < 0) { normal.negate(); side.negate(); }
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, depth, width), material);
  mesh.name = name;
  mesh.position.copy(a).add(b).multiplyScalar(0.5).addScaledVector(normal, -drop);
  mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(dir, normal, side));
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
}

function eaveEdge(face: RoofFace) {
  let best = { a: face.points[0], b: face.points[1], y: Infinity };
  for (let i = 0; i < face.points.length; i++) {
    const a = face.points[i], b = face.points[(i + 1) % face.points.length];
    const y = (a.y + b.y) / 2;
    if (y < best.y - 1 || (Math.abs(y - best.y) < 1 && a.distanceTo(b) > best.a.distanceTo(best.b)))
      best = { a, b, y };
  }
  return best;
}

function containsXZ(face: RoofFace, x: number, z: number) {
  const polygon = face.points.map(p => [p.x, p.z] as [number, number]);
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i], [xj, zj] = polygon[j];
    if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / ((zj - zi) || 1e-9) + xi)) inside = !inside;
  }
  return inside;
}

function faceBasis(face: RoofFace) {
  const eave = eaveEdge(face);
  const across = eave.b.clone().sub(eave.a);
  across.y = 0;
  if (across.lengthSq() < 1e-8) across.set(1, 0, 0);
  else across.normalize();
  const acrossLen = eave.a.distanceTo(eave.b);
  const normal = faceNormal(face);
  // 水平坡向：只在 XZ 上量进深，避免 3D 坡向点积把 run 算成 0。
  const down = new THREE.Vector3().crossVectors(normal, across);
  down.y = 0;
  if (down.lengthSq() < 1e-8) down.set(-across.z, 0, across.x);
  else down.normalize();
  const mid = face.points.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1 / face.points.length);
  const eaveMid = eave.a.clone().add(eave.b).multiplyScalar(0.5);
  if (down.dot(new THREE.Vector3(eaveMid.x - mid.x, 0, eaveMid.z - mid.z)) < 0) down.negate();
  // down 从屋脊指向檐口；铺檩／椽改用檐口→屋脊的水平方向。
  const upslope = down.clone().negate();
  const run = Math.max(0, ...face.points.map(p => new THREE.Vector3(p.x - eaveMid.x, 0, p.z - eaveMid.z).dot(upslope)));
  return { across, upslope, eave, acrossLen, run };
}

function onSlope(face: RoofFace, across: THREE.Vector3, upslope: THREE.Vector3, origin: THREE.Vector3, u: number, v: number) {
  const x = origin.x + across.x * u + upslope.x * v;
  const z = origin.z + across.z * u + upslope.z * v;
  return new THREE.Vector3(x, roofHeight(face, x, z), z);
}

/** 将靠近檐口的端点沿梁轴线收回，避免矩形截面探出瓦角。 */
function insetEaveEndpoint(a: THREE.Vector3, b: THREE.Vector3, eaveY: number, inset: number) {
  const len = a.distanceTo(b);
  if (len < inset * 2 + 80) return { a: a.clone(), b: b.clone() };
  const t = inset / len;
  const aOut = a.y <= eaveY + 120 ? a.clone().lerp(b, t) : a.clone();
  const bOut = b.y <= eaveY + 120 ? b.clone().lerp(a, t) : b.clone();
  return { a: aOut, b: bOut };
}

/**
 * 按农村四坡常见木屋盖层次生成示意：正脊檩、斜脊梁、坡面檩条与椽子。
 * 几何跟随已有坡面与脊线；截面与间距为模型建议值，不作结构承托结论。
 */
export function addTimberRoofFrame(
  parent: THREE.Object3D,
  roof: { faces: RoofFace[]; ridges: RoofRidge[] },
  material: THREE.Material,
) {
  const group = new THREE.Group();
  group.name = "木屋盖梁架";
  parent.add(group);
  const eaveY = Math.min(...roof.faces.flatMap(face => face.points.map(p => p.y)));
  const peakY = Math.max(...roof.ridges.map(ridge => Math.max(ridge.a.y, ridge.b.y)), eaveY);

  for (const ridge of roof.ridges) {
    if (ridge.a.distanceTo(ridge.b) < 80) continue;
    if ((ridge.a.y + ridge.b.y) / 2 <= eaveY + 120) continue;
    const isMainRidge = Math.abs(ridge.a.y - ridge.b.y) < 40 && Math.abs(Math.max(ridge.a.y, ridge.b.y) - peakY) < 40;
    const section = isMainRidge ? ridgeSection : hipSection;
    // 斜脊梁檐口端收到天沟内挡以内，避免木头穿进水泥内挡。
    const ends = isMainRidge ? { a: ridge.a, b: ridge.b }
      : insetEaveEndpoint(ridge.a, ridge.b, eaveY, hipEaveInset(section.w));
    if (ends.a.distanceTo(ends.b) < 80) continue;
    timberBeam(group, ends.a, ends.b, section.w, section.d, material, frameDrop(section.d), isMainRidge ? "正脊檩" : "斜脊梁");
  }

  for (const face of roof.faces) {
    const { across, upslope, eave, acrossLen, run } = faceBasis(face);
    if (run < 200 || acrossLen < 200) continue;
    const origin = eave.a.clone();
    const purlinCount = Math.max(1, Math.round(run / 1000));
    const sideInset = spanEndInset(purlinSection.w);
    const trimSpan = (hits: THREE.Vector3[]) => {
      if (hits.length < 2) return null;
      const span = hits[0].distanceTo(hits[hits.length - 1]);
      if (span < sideInset * 2 + 80) return null;
      const t = sideInset / span;
      return {
        a: hits[0].clone().lerp(hits[hits.length - 1], t),
        b: hits[hits.length - 1].clone().lerp(hits[0], t),
      };
    };
    // 坡面构件的檐口侧进深：避开瓦下天沟内挡水泥带。
    const eaveClear = clearGutterInner(purlinSection.w);
    for (let i = 1; i <= purlinCount; i++) {
      const v = run * i / (purlinCount + 1);
      if (v < eaveClear) continue;
      const hits: THREE.Vector3[] = [];
      for (let k = 0; k <= 32; k++) {
        const u = acrossLen * k / 32;
        const p = onSlope(face, across, upslope, origin, u, v);
        if (containsXZ(face, p.x, p.z)) hits.push(p);
      }
      const ends = trimSpan(hits);
      if (!ends) continue;
      timberBeam(group, ends.a, ends.b, purlinSection.w, purlinSection.d, material, frameDrop(purlinSection.d), "坡面檩条");
    }
    const rafterClear = clearGutterInner(rafterSection.w);
    const rafterCount = Math.max(2, Math.round(acrossLen / 420));
    for (let i = 1; i < rafterCount; i++) {
      const u = acrossLen * i / rafterCount;
      const low = onSlope(face, across, upslope, origin, u, Math.min(Math.max(rafterClear, 80), run * 0.2));
      const high = onSlope(face, across, upslope, origin, u, Math.max(120, run - 80));
      if (!containsXZ(face, low.x, low.z) || !containsXZ(face, high.x, high.z)) continue;
      if (low.distanceTo(high) < 200) continue;
      timberBeam(group, high, low, rafterSection.w, rafterSection.d, material, frameDrop(rafterSection.d) + 25, "木椽");
    }
    // 檐檩整条落在内挡以内，不再压在天沟水泥内挡顶上。
    const eaveV = Math.min(Math.max(eaveClear, 50), run * 0.35);
    const eaveHits: THREE.Vector3[] = [];
    for (let k = 0; k <= 16; k++) {
      const u = acrossLen * k / 16;
      const p = onSlope(face, across, upslope, origin, u, eaveV);
      if (containsXZ(face, p.x, p.z)) eaveHits.push(p);
    }
    const eaveEnds = trimSpan(eaveHits);
    if (eaveEnds)
      timberBeam(group, eaveEnds.a, eaveEnds.b, purlinSection.w, purlinSection.d, material, frameDrop(purlinSection.d), "檐檩");
  }
  return group;
}
