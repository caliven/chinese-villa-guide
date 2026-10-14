import * as THREE from "three";
import { site, floors, annexPartitions, annexFurniture } from "./data";
import { facades } from "./facades";
import { cornice, carvedPilaster, glassBalustrade, gutteredRoof, downpipe, meander, bayCanopy, openingFrame } from "./facade-details";
import {
  box,
  slab,
  rect,
  wallWithOpenings,
  railing,
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
    // 楼板外缘收进墙身。三楼北缘若停在 Z=-1，会和二楼北墙外皮共面，缩放时闪成黄带。
    const inset = 0.05;
    // 侧面再收一些，楼板边不要贴到角柱侧面。
    const sideInset = 0.16;
    const outline =
      index === 1
        ? ([
            [6.8 + sideInset, -1 + inset],
            [20.3 - sideInset, -1 + inset],
            [20.3 - sideInset, 9 - inset],
            [11.4 + inset, 9 - inset],
            [11.4 + inset, 3 + inset],
            [6.8 + sideInset, 3 + inset],
          ] as [number, number][])
        : index === 2
          ? rect(m.x + sideInset, 0.86, m.w - 2 * sideInset, 8.95 - 0.86)
          : rect(
              m.x + sideInset,
              front + inset,
              m.w - 2 * sideInset,
              back - front - 2 * inset,
            );
    slab(g, outline, base, 0.18, mat.floor, holes);
    for (const facade of facades(index))
      wallWithOpenings(g, facade.a, facade.b, base, h, facade.openings, mat);
    if (index === 2) {
      const porchFront = m.z - site.portico.projection;
      // 中间露台随官帽前伸；两侧停在退台前，中间留空，三块楼板互不连通。
      slab(
        g,
        rect(6.98, -0.96, 3.74, 1.8),
        base,
        0.18,
        mat.floor,
      ).name = "三楼左侧露台";
      slab(
        g,
        rect(16.68, -0.96, 3.44, 1.8),
        base,
        0.18,
        mat.floor,
      ).name = "三楼右侧露台";
      // 平台北缘让进檐口。南缘收到三楼前墙外，不并入两侧露台。
      slab(
        g,
        rect(site.portico.x, porchFront + 0.04, site.portico.w, 0.84 - (porchFront + 0.04)),
        base,
        0.22,
        mat.floor,
      ).name = "外伸门厅三楼平台";
      glassBalustrade(g, [7.16, -0.9], [10.54, -0.9], base, mat);
      glassBalustrade(g, [7.16, -0.9], [7.16, 0.65], base, mat, true);
      glassBalustrade(g, [10.54, -0.9], [10.54, 0.65], base, mat, true);
      glassBalustrade(g, [16.86, -0.9], [19.94, -0.9], base, mat);
      glassBalustrade(g, [16.86, -0.9], [16.86, 0.65], base, mat, true);
      glassBalustrade(g, [19.94, -0.9], [19.94, 0.65], base, mat, true);
      glassBalustrade(g, [11.38, porchFront + 0.16], [16.02, porchFront + 0.16], base, mat);
      glassBalustrade(g, [11.38, porchFront + 0.16], [11.38, 0.7], base, mat, true);
      glassBalustrade(g, [16.02, porchFront + 0.16], [16.02, 0.7], base, mat, true);
      // 二楼顶部的正面飘檐70cm，门厅平台只在三楼标高出现。
      // 两端收进侧墙外皮，端头不再和东西墙共面。
      for (const [x, width] of [[m.x + 0.03, 4.47], [16.1, 4.17]])
        cornice(g, x, m.z - site.secondFrontEave, width, site.secondFrontEave + 0.24, base, mat).name = "二楼前飘檐70厘米";
      cornice(g, site.portico.x, porchFront, site.portico.w, site.portico.projection + 0.24, base, mat);
    }
    // 隔墙画到外皮时，端头和外围墙面共面，外面会看到一条白竖线。端头埋进墙身 2cm。
    const embed = 0.22;
    const bury = (p: [number, number]): [number, number] => {
      let [x, z] = p;
      if (Math.abs(x - m.x) <= 0.02) x = m.x + embed;
      else if (Math.abs(x - (m.x + m.w)) <= 0.02) x = m.x + m.w - embed;
      if (Math.abs(z - front) <= 0.02) z = front + embed;
      else if (Math.abs(z - back) <= 0.02) z = back - embed;
      return [x, z];
    };
    for (const part of floor.partitions) {
      const a = bury(part.a),
        b = bury(part.b),
        pulled = Math.hypot(a[0] - part.a[0], a[1] - part.a[1]);
      const op: Opening[] = part.door
        ? [
            {
              at: part.door.offset - pulled + part.door.width / 2,
              w: part.door.width,
              sill: 0,
              h: 2.2,
            },
          ]
        : [];
      wallWithOpenings(g, a, b, base, h - 0.15, op, mat, 0.12, true);
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
        [9.15, 4.55],
        [18.05, 4.15],
      ]) {
        box(g, x, base + h - 0.19, -1.06, w, 0.16, 0.16, mat.trim);
        box(g, x, base + h - 0.34, -1.04, w - 0.08, 0.055, 0.1, mat.stone);
        meander(g, x - w / 2 + 0.08, base + h - 0.28, -1.12, w - 0.2, mat);
      }
    if (index === 0) {
      for (const [x, w] of [
        [9.15, 4.7],
        [18.05, 4.2],
      ])
        box(g, x, 0.22, -1.08, w, 0.44, 0.14, mat.stone);
      openingFrame(g, 9.15, 0.38, -1.06, 3.15, 2.78, mat);
      openingFrame(g, 17.95, 0.38, -1.06, 2.55, 2.78, mat);
      openingFrame(g, 13.7, 2.66, -1.06, 1.65, 0.64, mat);
    }
    if (index === 1) {
      openingFrame(g, 9.15, 3.6 + 0.42, -1.06, 3.15, 2.52, mat);
      openingFrame(g, 13.7, 3.6 + 0.48, -1.06, 1.65, 2.42, mat);
      openingFrame(g, 17.95, 3.6 + 0.42, -1.06, 2.4, 2.52, mat);
    }
    if (index === 2) {
      const sidePosts = new THREE.Group();
      sidePosts.name = "三楼侧房间柱";
      g.add(sidePosts);
      for (const x of [7.32, 10.38, 16.98, 19.88])
        carvedPilaster(sidePosts, x, -0.5, base, 2.92, 0.4, mat);
      const hatPosts = new THREE.Group();
      hatPosts.name = "三楼官帽柱";
      g.add(hatPosts);
      for (const x of [11.68, 15.72])
        carvedPilaster(hatPosts, x, -2.58, base, 3.02, 0.52, mat);
      meander(g, 7.35, 10.18, 0.68, 2.9, mat);
      meander(g, 16.9, 10.18, 0.68, 2.7, mat);
      openingFrame(g, 9.15, 7.2 + 0.38, 0.7, 3.2, 2.35, mat);
      openingFrame(g, 17.95, 7.2 + 0.38, 0.7, 2.35, 2.35, mat);
    }
    for (const z of [back + 0.02])
      box(g, 13.55, base + h - 0.16, z, 13.56, 0.17, 0.16, mat.trim);
  });
  const portico = new THREE.Group();
  portico.name = "外伸2米的通高门厅";
  group.add(portico);
  const porchFront = m.z - site.portico.projection;
  for (const x of [11.68, 15.72]) {
    carvedPilaster(portico, x, porchFront + 0.39, 0, 7.04, 0.58, mat);
    box(portico, x, 2.85, porchFront - 0.02, 0.16, 0.72, 0.12, mat.dark);
    box(portico, x, 2.85, porchFront - 0.09, 0.1, 0.56, 0.02, mat.gold);
  }
  // 两侧立柱通跨一、二层；细部沿用参考图，避免在3.6米处截断立柱。
  for (const x of [7.12, 20.0]) carvedPilaster(portico, x, -0.78, 0, 7.04, 0.44, mat);
  for (const x of [11.15, 16.35]) carvedPilaster(portico, x, -0.78, 0, 7.04, 0.4, mat);
  box(portico, 13.7, 6.58, porchFront + 0.18, 3.7, 0.42, 0.36, mat.trim);
  meander(portico, 11.95, 6.52, porchFront - 0.02, 3.5, mat);
  slab(levels[0], rect(site.portico.x, porchFront, site.portico.w, site.portico.projection), 0.015, 0.18, mat.paving).name = "门厅地坪投影另计";
  // 正屋前、左、右各出80cm；天沟外缘即尺寸控制线。
  const mainEave = 10.5;
  const mainRoof = gutteredRoof(roof, m.x - site.thirdEave, floors[2].front - site.thirdEave,
    m.w + 2 * site.thirdEave, m.z + m.d + site.eave - (floors[2].front - site.thirdEave),
    mainEave, site.roofRise, mat);
  mainRoof.name = "正屋四坡";
  // 官帽是门厅上方另起的四坡。檐口略高于正屋檐，起坡减小，使脊线与正屋脊同高。
  const mainPeak = mainEave + 0.08 + site.roofRise;
  const hatFront = porchFront - 0.5;
  const hatBack = 1;
  const hatDepth = hatBack - hatFront;
  const hatRise = 1.2;
  const hat = gutteredRoof(
    roof,
    10.2,
    hatFront,
    7,
    hatDepth,
    mainPeak - hatRise - 0.08,
    hatRise,
    mat,
  );
  hat.name = "中央官帽";
  box(hat, 13.7, mainPeak - hatRise - 0.22, -2.55, 3.85, 0.28, 0.32, mat.trim);
  meander(hat, 11.9, mainPeak - hatRise - 0.28, -2.72, 3.6, mat);
  bayCanopy(roof, 7.45, -1.64, 3.15, 0.7, 7.28, 0.42, mat).name = "二楼左侧披檐";
  bayCanopy(roof, 16.55, -1.64, 2.7, 0.7, 7.28, 0.42, mat).name = "二楼右侧披檐";
  // 落水管收在墙边和后侧，避开官帽覆盖的正中。
  downpipe(roof, 6.96, 9.12, 6.18, 9.39, 10.5, mat);
  downpipe(roof, 20.14, 9.12, 20.93, 9.39, 10.5, mat);
  downpipe(roof, 9.35, 0.55, 8.85, 0.18, 10.5, mat);
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
  // 辅楼檐口与主楼同一套环形天沟；外轮廓仍按原披檐，不向外加宽。
  gutteredRoof(annexRoof, 0.25, -1.55, 5.6, 11.1, 3.6, 1.4, mat);
  downpipe(annexRoof, 1.2, 8.5, 0.62, 9.15, 3.6, mat);
  downpipe(annexRoof, 4.9, 8.5, 5.48, 9.15, 3.6, mat);
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
