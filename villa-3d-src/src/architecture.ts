import * as THREE from "three";
import { site, floors, annexPartitions, annexFurniture } from "./data";
import { facades } from "./facades";
import { cornice, carvedPilaster, glassBalustrade, gutteredRoof, downpipe, meander } from "./facade-details";
import {
  box,
  slab,
  rect,
  wallWithOpenings,
  railing,
  hipRoof,
  furnish,
  stairs,
  tag,
  type Mats,
  type Opening,
} from "./primitives";

export function buildVilla(mat: Mats, withLabels = true) {
  const group = new THREE.Group(),
    roof = new THREE.Group(),
    balcony = new THREE.Group(),
    annex = new THREE.Group(),
    annexRoof = new THREE.Group();
  const levels: THREE.Group[] = [];
  const labels: THREE.Group[] = [];
  group.add(roof, balcony, annex, annexRoof);
  const m = site.main;
  floors.forEach((floor, index) => {
    const g = new THREE.Group();
    g.name = `floor-${index + 1}`;
    levels.push(g);
    group.add(g);
    const front = floor.front,
      back = m.z + m.d,
      base = floor.y,
      h = floor.height;
    const holes = index > 0 ? [rect(17.02, 1.2, 3.15, 3.05)] : [];
    const outline =
      index === 1
        ? ([
            [6.8, -1],
            [11.4, -1],
            [11.4, 0.7],
            [16, 0.7],
            [16, -1],
            [20.3, -1],
            [20.3, 9],
            [11.4, 9],
            [11.4, 3],
            [6.8, 3],
          ] as [number, number][])
        : rect(
            m.x,
            index === 2 ? -1 : front,
            m.w,
            index === 2 ? 10 : back - front,
          );
    slab(g, outline, base, 0.18, mat.floor, holes);
    for (const facade of facades(index))
      wallWithOpenings(g, facade.a, facade.b, base, h, facade.openings, mat);
    if (index === 2) {
      const porchFront = m.z - site.portico.projection;
      slab(g, rect(site.portico.x, porchFront, site.portico.w, site.portico.projection), base, 0.22, mat.floor).name = "外伸门厅三楼平台";
      glassBalustrade(g, [6.99, -0.85], [11.46, -0.85], base, mat);
      glassBalustrade(g, [11.46, -0.85], [11.46, porchFront + 0.18], base, mat);
      glassBalustrade(g, [11.46, porchFront + 0.18], [15.94, porchFront + 0.18], base, mat);
      glassBalustrade(g, [15.94, porchFront + 0.18], [15.94, -0.85], base, mat);
      glassBalustrade(g, [15.94, -0.85], [20.11, -0.85], base, mat);
      glassBalustrade(g, [6.99, -0.85], [6.99, front], base, mat);
      glassBalustrade(g, [20.11, -0.85], [20.11, front], base, mat);
      // 二楼顶部的正面飘檐70cm，门厅平台只在三楼标高出现。
      for (const [x, width] of [[m.x, 4.5], [16.1, 4.2]])
        cornice(g, x, m.z - site.secondFrontEave, width, site.secondFrontEave + 0.24, base, mat).name = "二楼前飘檐70厘米";
      cornice(g, site.portico.x, porchFront, site.portico.w, site.portico.projection + 0.24, base, mat);
    }
    for (const part of floor.partitions) {
      const op: Opening[] = part.door
        ? [
            {
              at: part.door.offset + part.door.width / 2,
              w: part.door.width,
              sill: 0,
              h: 2.2,
            },
          ]
        : [];
      wallWithOpenings(g, part.a, part.b, base, h - 0.15, op, mat, 0.12, true);
    }
    for (const f of floor.furniture) furnish(g, f, base, mat);
    const labelGroup = new THREE.Group();
    labelGroup.visible = false;
    g.add(labelGroup);
    labels.push(labelGroup);
    for (const room of withLabels ? floor.rooms : []) {
      const [x, z] = room.label ?? [room.x + room.w / 2, room.z + room.d / 2];
      tag(
        labelGroup,
        room.name,
        x,
        base + 0.7,
        z,
        "#284b3b",
        room.kind === "bath" ? 0.36 : 0.58,
      );
    }
    if (index < 2) stairs(g, 16.12, 1.2, base, h, mat);
    if (index === 1) railing(g, [11.47, 3.04], [11.47, 8.85], base, mat);
    if (index > 0) railing(g, [17.06, 2.35], [17.06, 3.1], base, mat);
    // 石材腰线只沿建筑外围；门厅正中保持通高。
    if (index < 2)
      for (const [x, w] of [
        [9.1, 4.6],
        [18.15, 4.3],
      ]) {
        box(g, x, base + h - 0.19, -1.05, w + 0.08, 0.23, 0.19, mat.trim);
        box(g, x, base + h - 0.36, -1.025, w + 0.03, 0.065, 0.13, mat.stone);
      }
    if (index === 2) {
      for (const x of [7.08, 20.02]) carvedPilaster(g, x, front + 0.13, base, h, 0.44, mat);
      for (const x of [11.53, 15.87]) carvedPilaster(g, x, front + 0.08, base, h + 1.0, 0.48, mat);
      box(g, 13.7, 10.37, front - 0.05, 3.82, 0.38, 0.24, mat.trim);
      meander(g, 11.86, 10.36, front - 0.184, 3.7, mat);
    }
    for (const z of [back + 0.02])
      box(g, 13.55, base + h - 0.16, z, 13.56, 0.17, 0.16, mat.trim);
  });
  const portico = new THREE.Group();
  portico.name = "外伸2米的通高门厅";
  group.add(portico);
  const porchFront = m.z - site.portico.projection;
  for (const x of [11.68, 15.72]) {
    carvedPilaster(portico, x, porchFront + 0.39, 0, 7.04, 0.64, mat);
    box(portico, x, 2.75, porchFront - 0.01, 0.19, 0.82, 0.16, mat.dark);
    box(portico, x, 2.75, porchFront - 0.102, 0.12, 0.67, 0.025, mat.gold);
  }
  // 两侧立柱通跨一、二层；细部沿用参考图，避免在3.6米处截断立柱。
  for (const x of [7.07, 20.03]) carvedPilaster(portico, x, -0.75, 0, 7.04, 0.46, mat);
  box(portico, 13.7, 6.54, porchFront + 0.2, 3.5, 0.45, 0.38, mat.trim);
  meander(portico, 12.04, 6.49, porchFront - 0.006, 3.35, mat);
  slab(levels[0], rect(site.portico.x, porchFront, site.portico.w, site.portico.projection), 0.015, 0.18, mat.paving).name = "门厅地坪投影另计";
  // 主屋顶前、左、右各出80cm；天沟外缘即尺寸控制线。
  gutteredRoof(roof, m.x - site.thirdEave, floors[2].front - site.thirdEave,
    m.w + 2 * site.thirdEave, m.z + m.d + site.eave - (floors[2].front - site.thirdEave),
    10.5, site.roofRise, mat);
  // 参考图中央帽顶高于两翼；同样采用内收瓦口与环形天沟。
  const crown = new THREE.Group();
  crown.name = "中央抬高官帽";
  roof.add(crown);
  box(crown, 13.7, 11.05, 1.14, 4.82, 1.5, 0.68, mat.trim);
  for (let i = 0; i < 36; i++) box(crown, 11.7 + i * 0.114, 11.35, 0.785, 0.035, 0.38, 0.055, mat.wall);
  meander(crown, 11.55, 10.96, 0.77, 4.3, mat);
  gutteredRoof(crown, 10.5, 0, 6.4, 4.5, 11.8, 1.35, mat);
  // 落水管收在墙边和后侧，不再占用80cm檐口之外的边界。
  downpipe(roof, 6.96, 8.94, 6.18, 9.39, 10.5, mat);
  downpipe(roof, 20.14, 8.94, 20.93, 9.39, 10.5, mat);
  downpipe(roof, 11.5, 1.05, 10.65, 0.16, 11.8, mat);
  // 浅阳台位于三层公共过厅外，避免直接放在老人房上方。
  slab(balcony, rect(12.65, 9, 2.5, 1.2), 7.2, 0.18, mat.paving);
  railing(balcony, [12.7, 10.15], [15.1, 10.15], 7.2, mat);
  railing(balcony, [12.7, 9], [12.7, 10.15], 7.2, mat);
  railing(balcony, [15.1, 9], [15.1, 10.15], 7.2, mat);
  balcony.visible = false;

  const a = site.annex;
  slab(annex, rect(a.x, a.z, a.w, a.d), 0, 0.18, mat.floor);
  for (const facade of facades(3))
    wallWithOpenings(annex, facade.a, facade.b, 0, 3.6, facade.openings, mat);
  for (const p of annexPartitions)
    wallWithOpenings(
      annex,
      p.a,
      p.b,
      0,
      3.4,
      p.door
        ? [
            {
              at: p.door.offset + p.door.width / 2,
              w: p.door.width,
              sill: 0,
              h: 2.2,
            },
          ]
        : [],
      mat,
      0.12,
      true,
    );
  annexFurniture.forEach((f) => furnish(annex, f, 0, mat));
  // 用户已确认右端仍有约3米旱地，辅楼檐角无需沿旧的估算尖角裁切。
  hipRoof(annexRoof, 3.05, 4, 5.6, 11.1, 3.6, 1.4, mat);
  box(annexRoof, 1.65, 4.95, 7.95, 0.46, 3.1, 0.46, mat.stone);
  box(annexRoof, 1.65, 6.57, 7.95, 0.72, 0.12, 0.72, mat.dark);
  for (const x of [1.45, 1.85])
    box(annexRoof, x, 6.37, 7.95, 0.045, 0.32, 0.045, mat.metal);
  return { group, levels, roof, balcony, annex, annexRoof, portico, labels };
}

export function buildCar(mat: Mats, color = 0x64736b, placeholder = false) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.55,
    roughness: 0.25,
    transparent: placeholder,
    opacity: placeholder ? 0.35 : 1,
  });
  const v = site.vehicle;
  box(g, 0, 0.66, 0, v.width, 0.76, v.length, paint);
  box(g, 0, 1.23, 0.03, 1.88, 0.6, 3.9, paint);
  box(g, 0, 1.61, 0.0, 1.78, 0.27, 3.6, paint);
  box(g, 0, 1.37, -1.91, 1.71, 0.45, 0.025, mat.glass, false);
  box(g, 0, 1.37, 1.99, 1.67, 0.44, 0.025, mat.glass, false);
  for (const x of [-0.95, 0.95]) {
    box(g, x, 1.38, 0.1, 0.022, 0.45, 3.45, mat.glass, false);
    for (const z of [-0.75, 0.8]) box(g, x, 1.4, z, 0.04, 0.5, 0.065, mat.dark);
    // 未给含镜宽，不添加猜测的后视镜；通行面板明确提示缺失。
    for (const z of [-1.644, 1.461]) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.37, 0.37, 0.22, 24),
        mat.dark,
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.37, z);
      wheel.castShadow = true;
      g.add(wheel);
      const hub = new THREE.Mesh(
        new THREE.CylinderGeometry(0.24, 0.24, 0.235, 16),
        mat.metal,
      );
      hub.rotation.z = Math.PI / 2;
      hub.position.copy(wheel.position);
      g.add(hub);
    }
  }
  box(g, 0, 0.97, -v.length / 2 - 0.007, 1.7, 0.035, 0.018, mat.inside, false);
  box(g, 0, 1.79, -0.9, 0.35, 0.02, 0.2, mat.dark);
  return g;
}
