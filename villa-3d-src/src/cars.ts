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
  bevel = 40,
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
      new THREE.BoxGeometry(tireWidth * 0.28, spokes > 6 ? 35 : 55, radius * 0.5),
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
  const geo = new THREE.TorusGeometry(radius, 45, 8, 18, Math.PI);
  geo.rotateY(Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(Math.sign(x) * (Math.abs(x) - 20), radius * 0.72, z);
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
  part(parent, x, y, z, 220, 100, 120, material);
  part(parent, x + sign * 80, y + 20, z + 20, 110, 70, 20, glass);
}

/** 2022 款理想 L9 Max。车身尺寸沿用已确认的公开参数，黑色金属漆。 */
export function buildL9(_mat: Mats) {
  const g = new THREE.Group();
  g.name = "理想L9";
  const v = site.vehicle;
  const half = v.length / 2;
  const frontAxle = -half + v.frontOverhang;
  const rearAxle = frontAxle + v.wheelbase;
  const paint = paintOf(0x161616, 340);
  const black = paintOf(0x0c0c0c, 550);
  const chrome = paintOf(0xb7bcc2, 220);
  const glass = glassOf();
  const tire = paintOf(0x1a1a1a, 850);
  const rim = paintOf(0xc5c8cc, 280);
  const bodyW = 1900;
  profileBody(
    g,
    [
      [-2500, 340],
      [-2580, 520],
      [-2540, 820],
      [-2280, 1020],
      [-1150, 1160],
      [-320, 1640],
      [150, 1720],
      [1650, 1740],
      [2180, 1680],
      [2400, 1280],
      [2560, 900],
      [2580, 500],
      [2400, 340],
      [-2150, 320],
    ],
    bodyW,
    paint,
    35,
  );
  part(g, 0, 420, 50, bodyW - 120, 160, v.length - 700, black);
  slopedPanel(
    g,
    new THREE.Vector3(0, 1180, -1080),
    new THREE.Vector3(0, 1640, -280),
    1550,
    30,
    glass,
  );
  slopedPanel(
    g,
    new THREE.Vector3(0, 1220, 2280),
    new THREE.Vector3(0, 1660, 2120),
    1420,
    30,
    glass,
  );
  for (const x of [-970, 970]) {
    part(g, x, 1400, 150, 30, 400, 850, glass);
    part(g, x, 1400, 1200, 30, 380, 700, glass);
    part(g, x, 1360, 1850, 30, 280, 320, glass);
    part(g, x, 1180, 720, 25, 25, 2700, chrome);
    part(g, x, 950, 100, 35, 40, 160, chrome);
    part(g, x, 950, 1150, 35, 40, 160, chrome);
  }
  part(g, 0, 900, -2620, 1620, 70, 50, lampOf(0xf2f5f8));
  part(g, 0, 900, -2660, 140, 90, 30, chrome);
  part(g, 0, 620, -2600, 1350, 280, 60, black);
  part(g, 0, 400, -2600, 1450, 90, 60, black);
  part(g, 0, 1080, 2620, 1550, 50, 40, lampOf(0xd24a4a));
  part(g, 0, 480, 2600, 1200, 100, 50, black);
  part(g, 0, 1800, -150, 280, 80, 220, black);
  for (const x of [-620, 620])
    part(g, x, 1780, 700, 40, 30, 2100, chrome);
  mirror(g, -1080, 1220, -420, paint, glass);
  mirror(g, 1080, 1220, -420, paint, glass);
  for (const x of [-980, 980])
    for (const z of [frontAxle, rearAxle]) {
      arch(g, x, z, 480, black);
      wheel(g, x, z, 390, 260, 10, tire, rim);
    }
  return g;
}

/** 2025 款吉利星愿。尺寸用厂商公开的 4135×1805×1570、轴距 2650。慕斯银车身，黑顶。 */
export function buildXingyuan(_mat: Mats) {
  const g = new THREE.Group();
  g.name = "吉利星愿";
  const length = 4135;
  const half = length / 2;
  const frontAxle = -half + 735;
  const rearAxle = frontAxle + 2650;
  const silver = paintOf(0xd5d8dc, 280);
  const black = paintOf(0x1a1a1a, 500);
  const glass = glassOf();
  const tire = paintOf(0x1a1a1a, 850);
  const rim = paintOf(0xe4e6e8, 300);
  const bodyW = 1720;
  profileBody(
    g,
    [
      [-1860, 300],
      [-2020, 480],
      [-1980, 720],
      [-1780, 900],
      [-1280, 1000],
      [-900, 1060],
      [-380, 1440],
      [50, 1520],
      [1100, 1530],
      [1500, 1440],
      [1780, 1120],
      [1960, 740],
      [2000, 460],
      [1780, 280],
      [-1500, 280],
    ],
    bodyW,
    silver,
    70,
  );
  part(g, 0, 1520, 450, bodyW + 20, 120, 1850, black);
  part(g, 0, 380, 0, bodyW - 200, 140, length - 550, black);
  slopedPanel(
    g,
    new THREE.Vector3(0, 1080, -950),
    new THREE.Vector3(0, 1460, -320),
    1380,
    30,
    glass,
  );
  slopedPanel(
    g,
    new THREE.Vector3(0, 1120, 1720),
    new THREE.Vector3(0, 1460, 1420),
    1200,
    30,
    glass,
  );
  for (const x of [-890, 890]) {
    part(g, x, 1280, 150, 30, 340, 720, glass);
    part(g, x, 1280, 1050, 30, 320, 550, glass);
    part(g, x, 1020, -150, 45, 40, 110, black);
    part(g, x, 1020, 850, 45, 40, 110, black);
  }
  for (const x of [-550, 550]) {
    const sign = Math.sign(x);
    part(g, x, 780, -2020, 460, 140, 80, lampOf(0xf7f8f4), [0, sign * 0.45, sign * -0.08]);
    part(g, x + sign * 80, 780, -1980, 200, 80, 30, black);
  }
  part(g, 0, 960, -1720, 160, 40, 20, black);
  part(g, 0, 420, -1960, 1350, 120, 60, black);
  for (const x of [-620, 620])
    part(g, x, 460, -1980, 50, 160, 30, lampOf(0xf4f6f2));
  for (const x of [-550, 550])
    part(g, x, 820, 1940, 280, 100, 40, lampOf(0xc43838), [0, Math.sign(x) * -0.4, 0]);
  part(g, 0, 1500, 1550, bodyW - 350, 40, 280, black);
  mirror(g, -980, 1120, -350, black, glass);
  mirror(g, 980, 1120, -350, black, glass);
  for (const x of [-900, 900])
    for (const z of [frontAxle, rearAxle]) {
      arch(g, x, z, 400, black);
      wheel(g, x, z, 326, 200, 5, tire, rim);
    }
  return g;
}
