import * as THREE from "three";
import { site } from "./data";
import { architecturalGlass, type Mats } from "./primitives";

// 外观参照公开照片和厂商尺寸，不是这辆实车的测绘。
// 负 Z 为车头，与路线朝向一致。后视镜只做出外观，不计入 L9 的 1.998 米车身宽。

const paintOf = (color: number, roughness = 0.28, metalness = 0.72) =>
  new THREE.MeshStandardMaterial({ color, metalness, roughness });

const glassOf = (tint = 0x7a93a6) => {
  const material = architecturalGlass();
  material.color.set(tint);
  material.metalness = 0.12;
  material.roughness = 0.06;
  material.transmission = 0.72;
  return material;
};

const lampOf = (color: number, intensity = 1.1) =>
  new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 0.22,
    metalness: 0.05,
  });

function profileBody(
  parent: THREE.Object3D,
  profile: [number, number][],
  width: number,
  material: THREE.Material,
  bevel = 28,
) {
  const shape = new THREE.Shape(profile.map(([z, y]) => new THREE.Vector2(z, y)));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: true,
    bevelThickness: bevel * 0.55,
    bevelSize: bevel,
    bevelSegments: 5,
    curveSegments: 10,
  });
  geo.translate(0, 0, -width / 2);
  geo.rotateY(-Math.PI / 2);
  geo.computeVertexNormals();
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

function roundedBox(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  material: THREE.Material,
  radius = 40,
) {
  const geo = new THREE.BoxGeometry(w, h, d, 2, 2, 2);
  const pos = geo.attributes.position;
  const hw = w / 2;
  const hh = h / 2;
  const hd = d / 2;
  const r = Math.min(radius, hw * 0.35, hh * 0.35, hd * 0.35);
  for (let i = 0; i < pos.count; i++) {
    let px = pos.getX(i);
    let py = pos.getY(i);
    let pz = pos.getZ(i);
    const sx = Math.sign(px) || 1;
    const sy = Math.sign(py) || 1;
    const sz = Math.sign(pz) || 1;
    const ax = Math.abs(px);
    const ay = Math.abs(py);
    const az = Math.abs(pz);
    if (ax > hw - r && ay > hh - r) {
      const cx = hw - r;
      const cy = hh - r;
      const dx = ax - cx;
      const dy = ay - cy;
      const len = Math.hypot(dx, dy) || 1;
      px = sx * (cx + (dx / len) * r);
      py = sy * (cy + (dy / len) * r);
    }
    if (ax > hw - r && az > hd - r) {
      const cx = hw - r;
      const cz = hd - r;
      const dx = ax - cx;
      const dz = az - cz;
      const len = Math.hypot(dx, dz) || 1;
      px = sx * (cx + (dx / len) * r);
      pz = sz * (cz + (dz / len) * r);
    }
    if (ay > hh - r && az > hd - r) {
      const cy = hh - r;
      const cz = hd - r;
      const dy = ay - cy;
      const dz = az - cz;
      const len = Math.hypot(dy, dz) || 1;
      py = sy * (cy + (dy / len) * r);
      pz = sz * (cz + (dz / len) * r);
    }
    pos.setXYZ(i, px, py, pz);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
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
  dish?: THREE.Material,
) {
  const y = radius;
  const tireGeo = new THREE.CylinderGeometry(radius, radius, tireWidth, 36);
  tireGeo.rotateZ(Math.PI / 2);
  const tireMesh = new THREE.Mesh(tireGeo, tire);
  tireMesh.position.set(x, y, z);
  tireMesh.castShadow = true;
  parent.add(tireMesh);

  const sidewall = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 0.82, radius * 0.14, 10, 28),
    tire,
  );
  sidewall.rotation.y = Math.PI / 2;
  sidewall.position.set(x, y, z);
  parent.add(sidewall);

  const rimGeo = new THREE.CylinderGeometry(radius * 0.62, radius * 0.66, tireWidth * 0.42, 28);
  rimGeo.rotateZ(Math.PI / 2);
  const rimMesh = new THREE.Mesh(rimGeo, rim);
  rimMesh.position.set(x, y, z);
  parent.add(rimMesh);

  if (dish) {
    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.48, radius * 0.48, tireWidth * 0.12, 24),
      dish,
    );
    plate.rotation.z = Math.PI / 2;
    plate.position.set(x + Math.sign(x) * tireWidth * 0.08, y, z);
    parent.add(plate);
  }

  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.16, radius * 0.16, tireWidth * 0.55, 16),
    rim,
  );
  hub.rotation.z = Math.PI / 2;
  hub.position.set(x, y, z);
  parent.add(hub);

  const spokeW = spokes >= 8 ? 28 : spokes >= 5 ? 36 : 48;
  for (let i = 0; i < spokes; i++) {
    const angle = (i / spokes) * Math.PI * 2;
    const dir = new THREE.Vector3(0, Math.sin(angle), Math.cos(angle));
    const spoke = new THREE.Mesh(
      new THREE.BoxGeometry(tireWidth * 0.22, spokeW, radius * 0.46),
      rim,
    );
    spoke.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    spoke.position.set(x, y, z).addScaledVector(dir, radius * 0.3);
    parent.add(spoke);
  }
}

function arch(
  parent: THREE.Object3D,
  x: number,
  z: number,
  radius: number,
  material: THREE.Material,
  width = 90,
) {
  const geo = new THREE.TorusGeometry(radius, width * 0.42, 10, 22, Math.PI);
  geo.rotateY(Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(Math.sign(x) * (Math.abs(x) - 16), radius * 0.7, z);
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
  roundedBox(parent, x, y, z, 180, 95, 140, material, 28);
  part(parent, x + sign * 55, y + 8, z + 8, 18, 55, 90, material);
  part(parent, x + sign * 95, y + 12, z + 18, 8, 70, 100, glass);
}

function doorCrease(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  h: number,
  material: THREE.Material,
) {
  part(parent, x, y, z, 8, h, 18, material);
}

function handle(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  material: THREE.Material,
  hidden = false,
) {
  if (hidden) {
    part(parent, x, y, z, 18, 14, 90, material);
    return;
  }
  roundedBox(parent, x, y, z, 28, 22, 110, material, 8);
}

/** 2022 款理想 L9 Max。车身尺寸沿用已确认的公开参数，黑色金属漆；一体星环灯带示意。 */
export function buildL9(_mat: Mats) {
  const g = new THREE.Group();
  g.name = "理想L9";
  const v = site.vehicle;
  const half = v.length / 2;
  const frontAxle = -half + v.frontOverhang;
  const rearAxle = frontAxle + v.wheelbase;
  const paint = paintOf(0x121212, 0.26, 0.78);
  const glossBlack = paintOf(0x0a0a0a, 0.18, 0.7);
  const trim = paintOf(0x2a2d31, 0.4, 0.55);
  const chrome = paintOf(0xc5cad0, 0.2, 0.9);
  const glass = glassOf(0x6f8799);
  const darkGlass = glassOf(0x3a4650);
  const tire = paintOf(0x141414, 0.92, 0.05);
  const rim = paintOf(0xd0d4d8, 0.28, 0.85);
  const dish = paintOf(0x1c1c1c, 0.45, 0.4);
  const bodyW = 1920;

  // 侧视：尾门一段连续斜面落到后保险杠，避免直立尾板。
  profileBody(
    g,
    [
      [-2480, 320],
      [-2580, 420],
      [-2600, 560],
      [-2550, 780],
      [-2400, 980],
      [-2100, 1080],
      [-1500, 1140],
      [-900, 1180],
      [-480, 1480],
      [-120, 1680],
      [220, 1740],
      [900, 1760],
      [1550, 1740],
      [1950, 1680],
      [2180, 1520],
      [2350, 1280],
      [2480, 980],
      [2550, 700],
      [2580, 480],
      [2500, 340],
      [2360, 300],
      [-2100, 300],
    ],
    bodyW,
    paint,
    42,
  );

  roundedBox(g, 0, 360, 40, bodyW + 40, 150, v.length - 520, glossBlack, 50);
  part(g, 0, 280, -2450, bodyW - 180, 120, 220, glossBlack);
  part(g, 0, 300, 2480, bodyW - 260, 100, 180, glossBlack);

  // 天幕只落在平顶段（前风挡顶之后），避免在玻璃上方飘出一块平板。
  roundedBox(g, 0, 1746, 520, 1200, 14, 1100, darkGlass, 12);
  roundedBox(g, 0, 1746, 1280, 1100, 12, 520, darkGlass, 10);

  slopedPanel(
    g,
    new THREE.Vector3(0, 1160, -1120),
    new THREE.Vector3(0, 1680, -260),
    1580,
    22,
    glass,
  );
  // 后风挡贴在尾门斜面上。
  slopedPanel(
    g,
    new THREE.Vector3(0, 1180, 2360),
    new THREE.Vector3(0, 1640, 2050),
    1460,
    28,
    glass,
  );
  // 尾门外钣金斜面（灯带贴此面，不再悬浮在车身外）。
  slopedPanel(
    g,
    new THREE.Vector3(0, 720, 2520),
    new THREE.Vector3(0, 1180, 2360),
    1680,
    36,
    paint,
  );
  slopedPanel(
    g,
    new THREE.Vector3(0, 980, 2440),
    new THREE.Vector3(0, 1120, 2385),
    1720,
    32,
    lampOf(0xd64545, 1.15),
  );

  for (const x of [-990, 990]) {
    const s = Math.sign(x);
    part(g, x, 1420, -120, 22, 360, 780, glass);
    part(g, x, 1420, 780, 22, 350, 720, glass);
    part(g, x, 1400, 1520, 22, 300, 420, glass);
    part(g, x, 1360, 1900, 22, 220, 260, glass);
    part(g, x, 1200, 520, 18, 18, 2860, chrome);
    doorCrease(g, x + s * 8, 900, 280, 520, trim);
    doorCrease(g, x + s * 8, 900, 1180, 520, trim);
    handle(g, x + s * 12, 980, 520, chrome, true);
    handle(g, x + s * 12, 980, 1380, chrome, true);
  }

  // 前星环灯贴合前脸：侧视 y≈920 时车身约在 z=-2445，灯带嵌在表面不外飘。
  roundedBox(g, 0, 920, -2455, 1860, 34, 22, lampOf(0xf4f7fb, 1.35), 10);
  for (const x of [-960, 960]) {
    part(g, x, 920, -2450, 64, 30, 18, lampOf(0xf0c85a, 0.9));
  }
  for (const x of [-620, 620]) {
    const s = Math.sign(x);
    roundedBox(g, x, 620, -2505, 400, 120, 55, glossBlack, 28);
    part(g, x + s * 40, 620, -2530, 150, 80, 22, lampOf(0xeef3f8, 0.75));
    part(g, x - s * 90, 620, -2520, 84, 64, 18, lampOf(0xd8dee6, 0.55));
  }
  roundedBox(g, 0, 720, -2485, 1480, 200, 40, paint, 36);
  part(g, 0, 430, -2510, 1400, 64, 45, trim);
  for (let i = -3; i <= 3; i++) {
    part(g, i * 160, 430, -2530, 90, 36, 10, glossBlack);
  }

  // 后保险杠贴斜面下沿，不再竖立尾板。
  part(g, 0, 420, 2520, 1280, 90, 70, glossBlack);

  mirror(g, -1085, 1200, -380, paint, glass);
  mirror(g, 1085, 1200, -380, paint, glass);

  for (const x of [-990, 990]) {
    for (const z of [frontAxle, rearAxle]) {
      arch(g, x, z, 470, glossBlack, 100);
      wheel(g, x, z, 395, 265, 5, tire, rim, dish);
    }
  }
  return g;
}

/** 2025 款吉利星愿。尺寸用厂商公开的 4135×1805×1570、轴距 2650。慕斯银车身，黑顶悬浮。 */
export function buildXingyuan(_mat: Mats) {
  const g = new THREE.Group();
  g.name = "吉利星愿";
  const length = 4135;
  const half = length / 2;
  const frontAxle = -half + 735;
  const rearAxle = frontAxle + 2650;
  const silver = paintOf(0xd7dbe0, 0.22, 0.78);
  const black = paintOf(0x17191c, 0.28, 0.55);
  const glossBlack = paintOf(0x0e0e10, 0.18, 0.65);
  const chrome = paintOf(0xe6e9ec, 0.22, 0.88);
  const glass = glassOf(0x6f8494);
  const darkGlass = glassOf(0x303840);
  const tire = paintOf(0x151515, 0.92, 0.05);
  const rim = paintOf(0xe8eaed, 0.3, 0.82);
  const dish = paintOf(0xb8bcc0, 0.35, 0.5);
  const bodyW = 1700;

  // 圆润小车侧视：低鼻、短前悬、上扬腰线、快背尾。
  profileBody(
    g,
    [
      [-1780, 260],
      [-1960, 360],
      [-2020, 500],
      [-1980, 700],
      [-1820, 900],
      [-1480, 1000],
      [-1080, 1060],
      [-620, 1120],
      [-280, 1380],
      [80, 1500],
      [520, 1540],
      [1100, 1520],
      [1480, 1400],
      [1720, 1180],
      [1900, 860],
      [2000, 560],
      [1980, 380],
      [1780, 260],
      [-1500, 250],
    ],
    bodyW,
    silver,
    58,
  );

  // 黑顶只盖平顶舱段，前缘停在风挡顶之后，避免玻璃上方飘板。
  roundedBox(g, 0, 1492, 620, bodyW - 80, 28, 1100, black, 18);
  roundedBox(g, 0, 1498, 600, 1180, 10, 900, darkGlass, 8);

  roundedBox(g, 0, 320, 20, bodyW - 80, 120, length - 480, glossBlack, 36);

  slopedPanel(
    g,
    new THREE.Vector3(0, 1080, -980),
    new THREE.Vector3(0, 1460, -280),
    1360,
    20,
    glass,
  );
  slopedPanel(
    g,
    new THREE.Vector3(0, 1120, 1680),
    new THREE.Vector3(0, 1460, 1380),
    1180,
    24,
    glass,
  );

  for (const x of [-880, 880]) {
    const s = Math.sign(x);
    part(g, x, 1280, 40, 20, 300, 700, glass);
    part(g, x, 1280, 900, 20, 290, 560, glass);
    part(g, x, 1240, 1400, 20, 230, 280, glass);
    part(g, x, 1110, 360, 14, 14, 1880, chrome);
    doorCrease(g, x + s * 6, 820, 360, 420, black);
    handle(g, x + s * 10, 900, 520, chrome, false);
  }

  // 微笑前脸：上扬水滴灯＋封闭前脸＋底部饰条
  for (const x of [-560, 560]) {
    const s = Math.sign(x);
    roundedBox(g, x, 780, -1990, 420, 150, 80, black, 48);
    part(g, x + s * 40, 800, -2025, 180, 70, 28, lampOf(0xf7f8f4, 1.05));
    part(g, x - s * 70, 760, -2010, 120, 50, 22, lampOf(0xdde3ea, 0.7));
    // C 形日行灯示意
    part(g, x + s * 120, 820, -2030, 30, 90, 16, lampOf(0xffffff, 1.2));
    part(g, x + s * 70, 860, -2030, 90, 24, 16, lampOf(0xffffff, 1.2));
    part(g, x + s * 70, 760, -2030, 90, 24, 16, lampOf(0xffffff, 1.2));
  }
  roundedBox(g, 0, 620, -1940, 980, 180, 50, silver, 40);
  part(g, 0, 980, -1720, 180, 36, 18, black);
  part(g, 0, 390, -1980, 1280, 90, 55, glossBlack);
  for (const x of [-520, 520]) {
    part(g, x, 390, -2005, 70, 70, 20, chrome);
  }

  // 分体尾灯贴在尾部斜面上
  for (const x of [-540, 540]) {
    const s = Math.sign(x);
    roundedBox(g, x, 860, 1945, 300, 120, 50, black, 36);
    part(g, x + s * 20, 860, 1970, 160, 70, 22, lampOf(0xd23c3c, 1.15), [0, s * -0.25, 0]);
  }
  roundedBox(g, 0, 480, 1940, 1180, 140, 60, silver, 30);
  part(g, 0, 340, 1960, 900, 50, 40, glossBlack);

  // 侧裙镀铬细条
  for (const x of [-860, 860]) {
    part(g, x, 360, 80, 12, 18, length - 900, chrome);
  }

  mirror(g, -970, 1100, -320, black, glass);
  mirror(g, 970, 1100, -320, black, glass);

  for (const x of [-900, 900]) {
    for (const z of [frontAxle, rearAxle]) {
      arch(g, x, z, 390, glossBlack, 80);
      wheel(g, x, z, 320, 205, 4, tire, rim, dish);
    }
  }
  return g;
}
