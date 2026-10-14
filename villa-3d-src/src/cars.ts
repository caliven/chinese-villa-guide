import * as THREE from "three";
import { site } from "./data";
import { architecturalGlass, type Mats } from "./primitives";

// 外观参照公开照片和厂商尺寸，不是这辆实车的测绘。
// 负 Z 为车头，与路线朝向一致。后视镜只做出外观，不计入 L9 的 1.998 米车身宽。

const paintOf = (color: number, roughness = 0.32) =>
  new THREE.MeshStandardMaterial({ color, metalness: 0.62, roughness });

const glassOf = () => {
  const material = architecturalGlass();
  material.color.set(0x9eb4c4);
  material.metalness = 0.15;
  material.roughness = 0.08;
  return material;
};

const lampOf = (color: number) =>
  new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.85,
    roughness: 0.4,
  });

function profileBody(
  parent: THREE.Object3D,
  profile: [number, number][],
  width: number,
  material: THREE.Material,
  bevel = 0.04,
) {
  const shape = new THREE.Shape(profile.map(([z, y]) => new THREE.Vector2(z, y)));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: true,
    bevelThickness: bevel * 0.7,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 4,
  });
  geo.translate(0, 0, -width / 2);
  geo.rotateY(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = mesh.receiveShadow = !(material as THREE.MeshPhysicalMaterial).transmission;
  parent.add(mesh);
  return mesh;
}

function part(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  material: THREE.Material,
  rot?: [number, number, number],
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
  mesh.castShadow = mesh.receiveShadow = !(material as THREE.MeshPhysicalMaterial).transmission;
  parent.add(mesh);
  return mesh;
}

function slopedPanel(
  parent: THREE.Object3D,
  bottom: THREE.Vector3,
  top: THREE.Vector3,
  width: number,
  thickness: number,
  material: THREE.Material,
) {
  const delta = top.clone().sub(bottom);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, thickness, delta.length()),
    material,
  );
  mesh.position.copy(bottom).add(top).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), delta.normalize());
  mesh.castShadow = !(material as THREE.MeshPhysicalMaterial).transmission;
  parent.add(mesh);
  return mesh;
}

function wheel(
  parent: THREE.Object3D,
  x: number,
  z: number,
  radius: number,
  tireWidth: number,
  spokes: number,
  tire: THREE.Material,
  rim: THREE.Material,
) {
  const y = radius;
  const tireGeo = new THREE.CylinderGeometry(radius, radius, tireWidth, 28);
  tireGeo.rotateZ(Math.PI / 2);
  const tireMesh = new THREE.Mesh(tireGeo, tire);
  tireMesh.position.set(x, y, z);
  tireMesh.castShadow = true;
  parent.add(tireMesh);
  const rimGeo = new THREE.CylinderGeometry(radius * 0.68, radius * 0.68, tireWidth * 0.55, 24);
  rimGeo.rotateZ(Math.PI / 2);
  const rimMesh = new THREE.Mesh(rimGeo, rim);
  rimMesh.position.set(x, y, z);
  parent.add(rimMesh);
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.18, radius * 0.18, tireWidth * 0.62, 12),
    rim,
  );
  hub.rotation.z = Math.PI / 2;
  hub.position.set(x, y, z);
  parent.add(hub);
  for (let i = 0; i < spokes; i++) {
    const angle = (i / spokes) * Math.PI * 2;
    const dir = new THREE.Vector3(0, Math.sin(angle), Math.cos(angle));
    const spoke = new THREE.Mesh(
      new THREE.BoxGeometry(tireWidth * 0.28, spokes > 6 ? 0.035 : 0.055, radius * 0.5),
      rim,
    );
    spoke.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    spoke.position.set(x, y, z).addScaledVector(dir, radius * 0.34);
    parent.add(spoke);
  }
}

function arch(
  parent: THREE.Object3D,
  x: number,
  z: number,
  radius: number,
  material: THREE.Material,
) {
  const geo = new THREE.TorusGeometry(radius, 0.045, 8, 18, Math.PI);
  geo.rotateY(Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(Math.sign(x) * (Math.abs(x) - 0.02), radius * 0.72, z);
  mesh.castShadow = true;
  parent.add(mesh);
}

function mirror(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  material: THREE.Material,
  glass: THREE.Material,
) {
  const sign = Math.sign(x) || 1;
  part(parent, x, y, z, 0.22, 0.1, 0.12, material);
  part(parent, x + sign * 0.08, y + 0.02, z + 0.02, 0.11, 0.07, 0.02, glass);
}

/** 2022 款理想 L9 Max。车身尺寸沿用已确认的公开参数，黑色金属漆。 */
export function buildL9(_mat: Mats) {
  const g = new THREE.Group();
  g.name = "理想L9";
  const v = site.vehicle;
  const half = v.length / 2;
  const frontAxle = -half + v.frontOverhang;
  const rearAxle = frontAxle + v.wheelbase;
  const paint = paintOf(0x161616, 0.34);
  const black = paintOf(0x0c0c0c, 0.55);
  const chrome = paintOf(0xb7bcc2, 0.22);
  const glass = glassOf();
  const tire = paintOf(0x1a1a1a, 0.85);
  const rim = paintOf(0xc5c8cc, 0.28);
  const bodyW = 1.9;
  profileBody(
    g,
    [
      [-2.5, 0.34],
      [-2.58, 0.52],
      [-2.54, 0.82],
      [-2.28, 1.02],
      [-1.15, 1.16],
      [-0.32, 1.64],
      [0.15, 1.72],
      [1.65, 1.74],
      [2.18, 1.68],
      [2.4, 1.28],
      [2.56, 0.9],
      [2.58, 0.5],
      [2.4, 0.34],
      [-2.15, 0.32],
    ],
    bodyW,
    paint,
    0.035,
  );
  part(g, 0, 0.42, 0.05, bodyW - 0.12, 0.16, v.length - 0.7, black);
  slopedPanel(
    g,
    new THREE.Vector3(0, 1.18, -1.08),
    new THREE.Vector3(0, 1.64, -0.28),
    1.55,
    0.03,
    glass,
  );
  slopedPanel(
    g,
    new THREE.Vector3(0, 1.22, 2.28),
    new THREE.Vector3(0, 1.66, 2.12),
    1.42,
    0.03,
    glass,
  );
  for (const x of [-0.97, 0.97]) {
    part(g, x, 1.4, 0.15, 0.03, 0.4, 0.85, glass);
    part(g, x, 1.4, 1.2, 0.03, 0.38, 0.7, glass);
    part(g, x, 1.36, 1.85, 0.03, 0.28, 0.32, glass);
    part(g, x, 1.18, 0.72, 0.025, 0.025, 2.7, chrome);
    part(g, x, 0.95, 0.1, 0.035, 0.04, 0.16, chrome);
    part(g, x, 0.95, 1.15, 0.035, 0.04, 0.16, chrome);
  }
  part(g, 0, 0.9, -2.62, 1.62, 0.07, 0.05, lampOf(0xf2f5f8));
  part(g, 0, 0.9, -2.66, 0.14, 0.09, 0.03, chrome);
  part(g, 0, 0.62, -2.6, 1.35, 0.28, 0.06, black);
  part(g, 0, 0.4, -2.6, 1.45, 0.09, 0.06, black);
  part(g, 0, 1.08, 2.62, 1.55, 0.05, 0.04, lampOf(0xd24a4a));
  part(g, 0, 0.48, 2.6, 1.2, 0.1, 0.05, black);
  part(g, 0, 1.8, -0.15, 0.28, 0.08, 0.22, black);
  for (const x of [-0.62, 0.62])
    part(g, x, 1.78, 0.7, 0.04, 0.03, 2.1, chrome);
  mirror(g, -1.08, 1.22, -0.42, paint, glass);
  mirror(g, 1.08, 1.22, -0.42, paint, glass);
  for (const x of [-0.98, 0.98])
    for (const z of [frontAxle, rearAxle]) {
      arch(g, x, z, 0.48, black);
      wheel(g, x, z, 0.39, 0.26, 10, tire, rim);
    }
  return g;
}

/** 2025 款吉利星愿。尺寸用厂商公开的 4135×1805×1570、轴距 2650。慕斯银车身，黑顶。 */
export function buildXingyuan(_mat: Mats) {
  const g = new THREE.Group();
  g.name = "吉利星愿";
  const length = 4.135;
  const half = length / 2;
  const frontAxle = -half + 0.735;
  const rearAxle = frontAxle + 2.65;
  const silver = paintOf(0xd5d8dc, 0.28);
  const black = paintOf(0x1a1a1a, 0.5);
  const glass = glassOf();
  const tire = paintOf(0x1a1a1a, 0.85);
  const rim = paintOf(0xe4e6e8, 0.3);
  const bodyW = 1.72;
  profileBody(
    g,
    [
      [-1.86, 0.3],
      [-2.02, 0.48],
      [-1.98, 0.72],
      [-1.78, 0.9],
      [-1.28, 1.0],
      [-0.9, 1.06],
      [-0.38, 1.44],
      [0.05, 1.52],
      [1.1, 1.53],
      [1.5, 1.44],
      [1.78, 1.12],
      [1.96, 0.74],
      [2.0, 0.46],
      [1.78, 0.28],
      [-1.5, 0.28],
    ],
    bodyW,
    silver,
    0.07,
  );
  part(g, 0, 1.52, 0.45, bodyW + 0.02, 0.12, 1.85, black);
  part(g, 0, 0.38, 0, bodyW - 0.2, 0.14, length - 0.55, black);
  slopedPanel(
    g,
    new THREE.Vector3(0, 1.08, -0.95),
    new THREE.Vector3(0, 1.46, -0.32),
    1.38,
    0.03,
    glass,
  );
  slopedPanel(
    g,
    new THREE.Vector3(0, 1.12, 1.72),
    new THREE.Vector3(0, 1.46, 1.42),
    1.2,
    0.03,
    glass,
  );
  for (const x of [-0.89, 0.89]) {
    part(g, x, 1.28, 0.15, 0.03, 0.34, 0.72, glass);
    part(g, x, 1.28, 1.05, 0.03, 0.32, 0.55, glass);
    part(g, x, 1.02, -0.15, 0.045, 0.04, 0.11, black);
    part(g, x, 1.02, 0.85, 0.045, 0.04, 0.11, black);
  }
  for (const x of [-0.55, 0.55]) {
    const sign = Math.sign(x);
    part(g, x, 0.78, -2.02, 0.46, 0.14, 0.08, lampOf(0xf7f8f4), [0, sign * 0.45, sign * -0.08]);
    part(g, x + sign * 0.08, 0.78, -1.98, 0.2, 0.08, 0.03, black);
  }
  part(g, 0, 0.96, -1.72, 0.16, 0.04, 0.02, black);
  part(g, 0, 0.42, -1.96, 1.35, 0.12, 0.06, black);
  for (const x of [-0.62, 0.62])
    part(g, x, 0.46, -1.98, 0.05, 0.16, 0.03, lampOf(0xf4f6f2));
  for (const x of [-0.55, 0.55])
    part(g, x, 0.82, 1.94, 0.28, 0.1, 0.04, lampOf(0xc43838), [0, Math.sign(x) * -0.4, 0]);
  part(g, 0, 1.5, 1.55, bodyW - 0.35, 0.04, 0.28, black);
  mirror(g, -0.98, 1.12, -0.35, black, glass);
  mirror(g, 0.98, 1.12, -0.35, black, glass);
  for (const x of [-0.9, 0.9])
    for (const z of [frontAxle, rearAxle]) {
      arch(g, x, z, 0.4, black);
      wheel(g, x, z, 0.326, 0.2, 5, tire, rim);
    }
  return g;
}
