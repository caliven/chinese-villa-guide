import * as THREE from "three";
import { site, floors, frontElevation, stairLayout, construction, circulation, annexPartitions, annexFurniture, type Point } from "./data";
import { eastTransom, facades, secondFloorGlassHead, secondFloorSideGlassHead } from "./facades";
import { carvedPilaster, cornerPilaster, balconyCornerPost, recessedHatPier, glassBalustrade, gutteredRoof, hipRise, meander, tiledApron, projectingHatRoof, openingFrame, brownSlashPanel, apronFasciaBottom } from "./facade-details";
import {
  box,
  slab,
  rect,
  wallWithOpenings,
  railing,
  furnish,
  stairs,
  tag,
  bronzeEntryDoor,
  type Mats,
  type Opening,
} from "./primitives";

// 两根门厅柱前面是整块垫高，三步只嵌在柱与柱中间。
// 面对房子时左侧为东。坡道外侧边贴着柱北缘，分别向东、向西延伸，不伸向院坪栏杆。
function entranceApproach(parent: THREE.Object3D, mat: Mats) {
  const g = new THREE.Group();
  g.name = "门厅柱间三步与两侧坡道";
  parent.add(g);
  const rise = site.entranceRise;
  const tread = construction.entranceTread;
  const [west, east] = frontElevation.balustradePosts.slice(1, 3);
  const westOuter = west.x - west.w / 2;
  const westInner = west.x + west.w / 2;
  const eastInner = east.x - east.w / 2;
  const eastOuter = east.x + east.w / 2;
  const columnNorth = frontElevation.porticoColumnZ - frontElevation.porticoColumnDepth / 2;
  const doorZ = site.main.z;
  const landingFront = columnNorth - construction.entranceLandingOffset;
  const stepFront = landingFront - tread * 2;
  const stone = mat.darkStone;
  box(
    g, (westOuter + eastOuter) / 2, rise / 2, (landingFront + doorZ) / 2,
    eastOuter - westOuter, rise, doorZ - landingFront, stone,
  );
  const cheeks = new THREE.Group();
  cheeks.name = "柱前垫高";
  g.add(cheeks);
  for (const [x0, x1] of [[westOuter, westInner], [eastInner, eastOuter]] as [number, number][]) {
    box(
      cheeks, (x0 + x1) / 2, rise / 2, (stepFront + landingFront) / 2,
      x1 - x0, rise, landingFront - stepFront + 0.01, stone,
    );
  }
  const steps = new THREE.Group();
  steps.name = "柱间三步";
  g.add(steps);
  for (const [top, z0] of [
    [rise / 3, stepFront],
    [(rise * 2) / 3, stepFront + tread],
  ] as [number, number][]) {
    const z1 = z0 + tread + 0.01;
    box(steps, (westInner + eastInner) / 2, top / 2, (z0 + z1) / 2, eastInner - westInner, top, z1 - z0, stone);
    treadLines(steps, westInner, eastInner, top, z0, mat.darkStoneGroove);
  }
  treadLines(g, westInner, eastInner, rise, landingFront, mat.darkStoneGroove);
  // 原先拉到墙角柱，大约 3.7 米。改短到 2 米，坡大约 1:5，是缩短后的设计坡度。
  const rampRun = construction.entranceRampRun;
  const south = doorZ + 0.02;
  const eastRamp = wedgeAlongX(g, south, columnNorth, eastOuter - 0.02, eastOuter + rampRun, rise, 0.02, stone);
  eastRamp.name = "东侧坡道";
  const westRamp = wedgeAlongX(g, south, columnNorth, westOuter + 0.02, westOuter - rampRun, rise, 0.02, stone);
  westRamp.name = "西侧坡道";
  rampGrooves(g, south, columnNorth, eastOuter, eastOuter + rampRun, rise, 0.02, mat.darkStoneRampMark);
  rampGrooves(g, south, columnNorth, westOuter, westOuter - rampRun, rise, 0.02, mat.darkStoneRampMark);
}

// 踏步前沿两道防滑线，收细，颜色接近石面，避免白线打眼。
function treadLines(
  parent: THREE.Object3D,
  x0: number, x1: number, y: number, zFront: number,
  material: THREE.Material,
) {
  const lines = new THREE.Group();
  lines.name = "台阶防滑线";
  parent.add(lines);
  const cx = (x0 + x1) / 2;
  const w = x1 - x0 - 0.06;
  for (const back of [0.04, 0.07])
    box(lines, cx, y + 0.003, zFront + back, w, 0.006, 0.008, material, false);
}

// 防滑条横着拦住坡向，沿坡面略高出石面。
function rampGrooves(
  parent: THREE.Object3D,
  z0: number, z1: number, xHigh: number, xLow: number, yHigh: number, yLow: number,
  material: THREE.Material,
) {
  const g = new THREE.Group();
  g.name = "坡道防滑条";
  parent.add(g);
  const run = xLow - xHigh;
  const spacing = 0.3;
  const bar = 0.02;
  const lift = 0.005;
  const zA = Math.min(z0, z1) + 0.08;
  const zB = Math.max(z0, z1) - 0.08;
  const yAt = (x: number) => yHigh + ((x - xHigh) / run) * (yLow - yHigh);
  const dir = Math.sign(run);
  for (let traveled = 0.28; traveled < Math.abs(run) - 0.18; traveled += spacing) {
    const xA = xHigh + dir * traveled;
    const xB = xA + dir * bar;
    const topA = yAt(xA) + lift;
    const topB = yAt(xB) + lift;
    const positions: number[] = [];
    const uvs: number[] = [];
    const along = xB - xA;
    pushQuad(positions, uvs, [xA, topA, zA], [xB, topB, zA], [xB, topB, zB], [xA, topA, zB], [0, 1, 0]);
    pushQuad(positions, uvs, [xA, topA - lift, zA], [xA, topA - lift, zB], [xB, topB - lift, zB], [xB, topB - lift, zA], [0, -1, 0]);
    pushQuad(positions, uvs, [xA, topA, zA], [xA, topA, zB], [xA, topA - lift, zB], [xA, topA - lift, zA], [-along, 0, 0]);
    pushQuad(positions, uvs, [xB, topB, zA], [xB, topB - lift, zA], [xB, topB - lift, zB], [xB, topB, zB], [along, 0, 0]);
    pushQuad(positions, uvs, [xA, topA, zA], [xA, topA - lift, zA], [xB, topB - lift, zA], [xB, topB, zA], [0, 0, -1]);
    pushQuad(positions, uvs, [xA, topA, zB], [xB, topB, zB], [xB, topB - lift, zB], [xA, topA - lift, zB], [0, 0, 1]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  }
}

function faceUv(p: number[], outward: number[]) {
  if (Math.abs(outward[0]) >= Math.abs(outward[1]) && Math.abs(outward[0]) >= Math.abs(outward[2]))
    return [p[2], p[1]];
  if (Math.abs(outward[1]) >= Math.abs(outward[2])) return [p[0], p[2]];
  return [p[0], p[1]];
}
function pushQuad(
  positions: number[], uvs: number[],
  a: number[], b: number[], c: number[], d: number[], outward: number[],
) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const normal = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const facing = normal[0] * outward[0] + normal[1] * outward[1] + normal[2] * outward[2] >= 0;
  const pts = facing ? [a, b, c, a, c, d] : [a, d, c, a, c, b];
  for (const p of pts) {
    positions.push(...p);
    uvs.push(...faceUv(p, outward));
  }
}

function wedgeAlongX(
  parent: THREE.Object3D,
  z0: number, z1: number, xHigh: number, xLow: number, yHigh: number, yLow: number,
  material: THREE.Material,
) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const xOut = xHigh - xLow;
  pushQuad(positions, uvs, [xHigh, yHigh, z0], [xHigh, yHigh, z1], [xLow, yLow, z1], [xLow, yLow, z0], [0, 1, 0]);
  pushQuad(positions, uvs, [xHigh, 0, z0], [xLow, 0, z0], [xLow, 0, z1], [xHigh, 0, z1], [0, -1, 0]);
  pushQuad(positions, uvs, [xHigh, yHigh, z0], [xHigh, 0, z0], [xHigh, 0, z1], [xHigh, yHigh, z1], [xOut, 0, 0]);
  pushQuad(positions, uvs, [xLow, yLow, z0], [xLow, yLow, z1], [xLow, 0, z1], [xLow, 0, z0], [-xOut, 0, 0]);
  pushQuad(positions, uvs, [xHigh, yHigh, z0], [xLow, yLow, z0], [xLow, 0, z0], [xHigh, 0, z0], [0, 0, z0 - z1]);
  pushQuad(positions, uvs, [xHigh, yHigh, z1], [xHigh, 0, z1], [xLow, 0, z1], [xLow, yLow, z1], [0, 0, z1 - z0]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

// 水包砂横槽：上下每隔 0.45 米一道，颜色贴近白麻墙，只做出凹陷。窗门和角柱处断开。
const groovePitch = 0.45;
const columnKeepOut: [number, number, number, number][] = [
  [6.6, 7.48, -1.34, -0.55],
  [19.86, 20.64, -1.34, -0.55],
  [6.58, 7.38, 8.42, 9.22],
  [19.72, 20.52, 8.42, 9.22],
  [6.6, 7.48, 0.46, 1.24],
  [19.86, 20.64, 0.46, 1.24],
];

function grooveYs(y0: number, y1: number, includeTop: boolean) {
  const limit = includeTop ? y1 + 0.001 : y1 - 0.12;
  const ys: number[] = [];
  for (let i = 1; i < 48; i++) {
    const y = Math.round(i * groovePitch * 1000) / 1000;
    if (y <= y0 + 0.06) continue;
    if (y > limit) break;
    ys.push(y);
  }
  return ys;
}

function subtractIntervals(span: [number, number], cuts: [number, number][]) {
  let parts: [number, number][] = [span];
  for (const [c0, c1] of cuts) {
    const next: [number, number][] = [];
    for (const [a0, a1] of parts) {
      if (c1 <= a0 + 1e-4 || c0 >= a1 - 1e-4) {
        next.push([a0, a1]);
        continue;
      }
      if (c0 > a0 + 0.02) next.push([a0, Math.min(c0, a1)]);
      if (c1 < a1 - 0.02) next.push([Math.max(c1, a0), a1]);
    }
    parts = next;
  }
  return parts.filter(([a, b]) => b - a >= 0.16);
}

function keepOutOnWall(ax: number, az: number, bx: number, bz: number, box: [number, number, number, number]) {
  const [x0, x1, z0, z1] = box;
  const len = Math.hypot(bx - ax, bz - az);
  if (Math.abs(bz - az) < 1e-4) {
    const z = az;
    if (z < z0 || z > z1) return null;
    const forward = ax <= bx;
    const lo = Math.max(Math.min(ax, bx), x0);
    const hi = Math.min(Math.max(ax, bx), x1);
    if (hi - lo < 0.02) return null;
    const s0 = forward ? lo - ax : ax - hi;
    const s1 = forward ? hi - ax : ax - lo;
    return [Math.max(0, s0), Math.min(len, s1)] as [number, number];
  }
  if (Math.abs(bx - ax) < 1e-4) {
    const x = ax;
    if (x < x0 || x > x1) return null;
    const forward = az <= bz;
    const lo = Math.max(Math.min(az, bz), z0);
    const hi = Math.min(Math.max(az, bz), z1);
    if (hi - lo < 0.02) return null;
    const s0 = forward ? lo - az : az - hi;
    const s1 = forward ? hi - az : az - lo;
    return [Math.max(0, s0), Math.min(len, s1)] as [number, number];
  }
  return null;
}

function sandGrooves(
  parent: THREE.Object3D,
  walls: { a: Point; b: Point; base: number; height: number; openings: Opening[]; includeTop: boolean }[],
  interior: Point,
  mat: Mats,
  avoidColumns: boolean,
) {
  const g = new THREE.Group();
  g.name = "水包砂凹槽";
  parent.add(g);
  const groove = mat.sand.clone();
  groove.color.set(0xd0cbc0);
  groove.roughness = 1;
  for (const wall of walls) {
    const [ax, az] = wall.a;
    const [bx, bz] = wall.b;
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.3) continue;
    const ux = dx / len;
    const uz = dz / len;
    let nx = -uz;
    let nz = ux;
    const midX = (ax + bx) / 2;
    const midZ = (az + bz) / 2;
    if ((midX - interior[0]) * nx + (midZ - interior[1]) * nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    const face = 0.125;
    const alongX = Math.abs(dx) >= Math.abs(dz);
    for (const y of grooveYs(wall.base, wall.base + wall.height, wall.includeTop)) {
      const localY = y - wall.base;
      const cuts: [number, number][] = [];
      for (const opening of wall.openings) {
        const y0 = opening.sill;
        const y1 = opening.span === "lower" ? wall.height : opening.sill + opening.h;
        if (localY + 0.012 < y0 || localY - 0.012 > y1) continue;
        cuts.push([opening.at - opening.w / 2 - 0.1, opening.at + opening.w / 2 + 0.1]);
      }
      if (az < -0.5 && bz < -0.5 && y > eastTransom.bottom && y < eastTransom.top)
        for (const opening of wall.openings)
          if (opening.pattern === "villa")
            cuts.push([opening.at - eastTransom.width / 2 - 0.12, opening.at + eastTransom.width / 2 + 0.12]);
      if (avoidColumns)
        for (const keep of columnKeepOut) {
          const hit = keepOutOnWall(ax, az, bx, bz, keep);
          if (hit) cuts.push(hit);
        }
      for (const [s0, s1] of subtractIntervals([0.05, len - 0.05], cuts)) {
        const t = (s0 + s1) / 2;
        box(
          g,
          ax + ux * t + nx * face,
          y,
          az + uz * t + nz * face,
          alongX ? s1 - s0 : 0.008,
          0.013,
          alongX ? 0.008 : s1 - s0,
          groove,
          false,
        );
      }
    }
  }
}

// 门上斜纹与左侧回纹横披同一高度、同一标高。上面的玻璃与左侧二楼窗同一高度、同一标高。
function entryScreen(parent: THREE.Object3D, mat: Mats) {
  const g = new THREE.Group();
  g.name = "门厅一二层通高门";
  parent.add(g);
  const x = 13.7;
  const w = 2.16;
  const band0 = eastTransom.bottom;
  const band1 = eastTransom.top;
  const doorH = band0 - site.entranceRise;
  bronzeEntryDoor(g, x, site.entranceRise, -0.9, w, doorH, mat);
  brownSlashPanel(g, x, (band0 + band1) / 2, -0.86, w, band1 - band0, mat);
  // 门洞宽 2.3 米，门扇和斜纹只有 2.16 米，两侧和左下角是透的。边条补到门洞边。
  const openingHalf = 1.15;
  for (const sign of [-1, 1] as const) {
    const outer = sign * openingHalf;
    const inner = sign * (w / 2 - 0.04);
    box(
      g,
      x + (outer + inner) / 2,
      (site.entranceRise + band1) / 2 - 0.02,
      -0.92,
      Math.abs(outer - inner),
      band1 - site.entranceRise + 0.06,
      0.2,
      mat.bronze,
      false,
    );
  }
  const glassH = secondFloorGlassHead - band1;
  box(g, x, band1 + glassH / 2, -0.84, w, glassH, 0.018, mat.lowE, false);
  for (const dx of [-0.5, 0.5])
    box(g, x + dx, band1 + glassH / 2, -0.9, 0.032, glassH, 0.03, mat.dark, false);
  box(g, x, band0, -0.96, 2.24, 0.04, 0.04, mat.bronze, false);
  box(g, x, band1, -0.96, 2.24, 0.04, 0.04, mat.bronze, false);
}

// 烤火房一二层之间：白底横披，中间一道回纹，上下各一条线脚。
function eastMeanderBand(parent: THREE.Object3D, mat: Mats) {
  const g = new THREE.Group();
  g.name = "烤火房回纹横披";
  parent.add(g);
  const x = 17.95;
  const { bottom, top, width } = eastTransom;
  const y = (bottom + top) / 2;
  const h = top - bottom;
  box(g, x, y, -1.03, width - 0.1, h, 0.07, mat.trim);
  // 上下两条离开白板，用没有贴图的细线。贴着石材贴图时会发毛。
  box(g, x, bottom + 0.05, -1.09, width - 0.16, 0.014, 0.014, mat.dark);
  box(g, x, top - 0.05, -1.09, width - 0.16, 0.014, 0.014, mat.dark);
  meander(g, x - (width - 0.4) / 2, y + 0.02, -1.07, width - 0.4, mat);
  for (const sign of [-1, 1])
    box(g, x + sign * (width / 2 + 0.035), y, -1.06, 0.07, h, 0.04, mat.trim);
}

export function buildVilla(mat: Mats, withLabels = true, fenShui = site.roofFenShui) {
  const group = new THREE.Group(),
    roof = new THREE.Group(),
    balcony = new THREE.Group(),
    annex = new THREE.Group(),
    annexRoof = new THREE.Group();
  const levels: THREE.Group[] = [];
  const labels: THREE.Group[] = [];
  group.add(roof, balcony, annex, annexRoof);
  const m = site.main;
  const elevation = frontElevation;
  floors.forEach((floor, index) => {
    const g = new THREE.Group();
    g.name = `floor-${index + 1}`;
    levels.push(g);
    group.add(g);
    const front = floor.front,
      back = m.z + m.d,
      base = floor.y,
      h = floor.height;
    const opening = stairLayout.hole;
    const holes = index > 0 ? [rect(opening.x, opening.z, opening.w, opening.d)] : [];
    const voidEast = circulation.livingVoid.x + circulation.livingVoid.w;
    const voidSouth = circulation.livingVoid.z + circulation.livingVoid.d;
    // 楼板外缘收进墙身。三楼北缘若停在 Z=-1，会和二楼北墙外皮共面，缩放时闪成黄带。
    const inset = 0.05;
    // 侧面再收一些，楼板边不要贴到角柱侧面。
    const sideInset = 0.16;
    // 正中门洞里能看到二楼楼板北缘，正面是一条黄带。这里把楼板收到斜纹板后面。
    const doorNotchWest = 12.55;
    const doorNotchEast = 14.85;
    const outline =
      index === 1
        ? ([
            [voidEast + inset, front + inset],
            [doorNotchWest, front + inset],
            [doorNotchWest, -0.72],
            [doorNotchEast, -0.72],
            [doorNotchEast, front + inset],
            [20.3 - sideInset, front + inset],
            [20.3 - sideInset, 9 - inset],
            [m.x + sideInset, back - inset],
            [m.x + sideInset, voidSouth + inset],
            [voidEast + inset, voidSouth + inset],
          ] as [number, number][])
        : index === 2
          ? rect(m.x + sideInset, 0.86, m.w - 2 * sideInset, 8.95 - 0.86)
          : rect(
              m.x + sideInset,
              front + inset,
              m.w - 2 * sideInset,
              back - front - 2 * inset,
            );
    // 一层完成面比院坪高三步。关掉房子后铺装仍在 ±0，不会和楼板叠在同一高度上闪。
    slab(g, outline, base + (index === 0 ? site.entranceRise : 0), construction.floorSlab, mat.floor, holes);
    const floorWalls = facades(index);
    for (const facade of floorWalls)
      wallWithOpenings(g, facade.a, facade.b, base, h, facade.openings, mat, construction.outsideWall, false, mat.sand);
    sandGrooves(
      g,
      floorWalls.map((facade) => ({
        a: facade.a,
        b: facade.b,
        base,
        height: h,
        openings: facade.openings,
        includeTop: index < 2,
      })),
      [13.55, 4],
      mat,
      true,
    );
    if (index === 2) {
      // 两侧楼板仍接到门厅楼板边，不往前加长。中间仍由墙隔开。
      elevation.sideTerraces.forEach((terrace, i) => {
        slab(g, rect(terrace.x, elevation.terraceFront, terrace.w, elevation.terraceBack - elevation.terraceFront), base, 0.18, mat.floor)
          .name = i === 0 ? "三楼左侧露台" : "三楼右侧露台";
      });
      // 平台北缘让进檐口。南缘收到三楼前墙外，不并入两侧露台。
      slab(
        g,
        rect(site.portico.x, elevation.centerFront, site.portico.w, elevation.terraceBack - elevation.centerFront),
        base,
        0.22,
        mat.floor,
      ).name = "外伸门厅三楼平台";
      const [westPost, middleWest, middleEast, eastPost] = elevation.balustradePosts;
      const shortPosts = new THREE.Group();
      shortPosts.name = "四根露台短柱";
      g.add(shortPosts);
      // 四根短柱立在 50 厘米挡墙顶上，柱身 0.8 米。门厅柱仍是 80 厘米，不跟短柱走。
      const parapet = elevation.eaveParapet;
      const postBase = base + parapet;
      const shortWidth = elevation.shortPostWidth;
      for (const post of elevation.balustradePosts)
        balconyCornerPost(shortPosts, post.x, post.z, postBase, elevation.balustradePostHeight, shortWidth, mat);
      // 两侧前栏杆只外移到现有楼板外沿，约 0.18 米，楼板不加长。里端仍落在中间两根柱的左右向中线。
      const frontWall = floor.front + 0.04;
      const sideFront = elevation.terraceFront;
      glassBalustrade(g, [westPost.x, sideFront], [middleWest.x, sideFront], postBase, mat);
      glassBalustrade(g, [westPost.x, sideFront], [westPost.x, frontWall], postBase, mat, true);
      glassBalustrade(g, [middleEast.x, sideFront], [eastPost.x, sideFront], postBase, mat);
      glassBalustrade(g, [eastPost.x, sideFront], [eastPost.x, frontWall], postBase, mat, true);
      glassBalustrade(g, [middleWest.x, middleWest.z], [middleEast.x, middleEast.z], postBase, mat);
      glassBalustrade(g, [middleWest.x, middleWest.z], [middleWest.x, elevation.postZ], postBase, mat, true);
      glassBalustrade(g, [middleEast.x, middleEast.z], [middleEast.x, elevation.postZ], postBase, mat, true);
      const west = elevation.sideTerraces[0].x;
      const east = elevation.sideTerraces[1].x + elevation.sideTerraces[1].w;
      const centerWest = site.portico.x, centerEast = site.portico.x + site.portico.w;
      const front = elevation.terraceFront, centerFront = elevation.centerFront, back = elevation.terraceBack;
      const eave = site.secondFrontEave;
      const inner: Point[] = [
        [west, back], [west, front], [centerWest, front], [centerWest, centerFront],
        [centerEast, centerFront], [centerEast, front], [east, front], [east, back],
      ];
      const outer: Point[] = [
        [west - eave, back], [west - eave, front - eave], [centerWest - eave, front - eave], [centerWest - eave, centerFront - eave],
        [centerEast + eave, centerFront - eave], [centerEast + eave, front - eave], [east + eave, front - eave], [east + eave, back],
      ];
      // 屋檐里有一道比露台地面高 50 厘米的墙。瓦从墙顶往外坡下，把这道墙挡住。
      const parapetWall = new THREE.Group();
      parapetWall.name = "三楼屋檐内50厘米挡墙";
      g.add(parapetWall);
      const parapetThick = 0.28;
      for (let i = 0; i < inner.length - 1; i++) {
        const a = inner[i], b = inner[i + 1];
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const len = Math.hypot(dx, dz);
        if (len < 0.05) continue;
        const ox = outer[i][0] - a[0], oz = outer[i][1] - a[1];
        const olen = Math.hypot(ox, oz) || 1;
        const alongX = Math.abs(dx) >= Math.abs(dz);
        // 墙收到露台一侧，北面贴着瓦的里沿。外面看是瓦，不是一道裸墙。
        box(
          parapetWall,
          (a[0] + b[0]) / 2 - (ox / olen) * parapetThick / 2,
          base + parapet / 2,
          (a[1] + b[1]) / 2 - (oz / olen) * parapetThick / 2,
          alongX ? len + parapetThick : parapetThick,
          parapet,
          alongX ? parapetThick : len + parapetThick,
          mat.sand,
        );
      }
      // 外沿平面位置不动。落差只用原来的檐坡，外沿跟着抬高，不再为了盖住挡墙把坡拉陡。
      tiledApron(g, inner, outer, base + parapet, elevation.tiledEaveDrop, mat);
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
      wallWithOpenings(g, a, b, base, h - 0.15, op, mat, construction.partition, true);
    }
    for (const f of floor.furniture) furnish(g, f, base + (index === 0 ? site.entranceRise : 0), mat);
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
    if (index < 2)
      stairs(
        g, stairLayout.x, stairLayout.z,
        base + (index === 0 ? site.entranceRise : 0),
        h - (index === 0 ? site.entranceRise : 0),
        mat,
        stairLayout.axis,
      );
    if (index === 1) {
      const edge = voidEast + 0.07;
      const southEdge = voidSouth + 0.06;
      railing(g, [edge, front + 0.16], [edge, southEdge], base, mat);
      railing(g, [m.x + 0.16, southEdge], [edge, southEdge], base, mat);
    }
    if (index > 0) {
      const { x: hx, z: hz, w: hw, d: hd } = opening;
      if (stairLayout.axis === "x") {
        const entry = stairLayout.flight + stairLayout.gap + 0.06;
        railing(g, [hx, hz], [hx + hw, hz], base, mat);
        railing(g, [hx + hw, hz], [hx + hw, hz + hd], base, mat);
        railing(g, [hx, hz + hd], [hx + hw, hz + hd], base, mat);
        railing(g, [hx, hz + entry], [hx, hz + hd], base, mat);
      } else {
        const northStop = hx + stairLayout.flight + 0.08;
        railing(g, [hx, hz], [hx, hz + hd], base, mat);
        railing(g, [hx + hw, hz], [hx + hw, hz + hd], base, mat);
        railing(g, [hx, hz + hd], [hx + hw, hz + hd], base, mat);
        railing(g, [hx, hz], [northStop, hz], base, mat);
      }
    }
    if (index === 0) {
      for (const [x, w] of [
        [9.15, 4.7],
        [18.05, 4.2],
      ])
        box(g, x, 0.22, -1.08, w, 0.44, 0.14, mat.stone);
      openingFrame(g, 9.15, site.entranceRise, -1.06, 3.15, 3.6 - site.entranceRise, mat, { top: false });
      openingFrame(g, 17.95, site.entranceRise + 0.34, -1.06, eastTransom.width, eastTransom.bottom - site.entranceRise - 0.34, mat, { top: false });
      // 大门上沿停在左侧回纹横披下沿，框顶不封口。
      openingFrame(g, 13.7, site.entranceRise, -1.06, 2.3, eastTransom.bottom - site.entranceRise, mat, { top: false });
    }
    if (index === 1) {
      openingFrame(g, 9.15, 3.6, -1.06, 3.15, secondFloorSideGlassHead - 3.6, mat, { bottom: false });
      openingFrame(g, 17.95, eastTransom.top, -1.06, eastTransom.width, secondFloorSideGlassHead - eastTransom.top + 0.04, mat, { bottom: false });
      openingFrame(g, 13.7, eastTransom.top, -1.06, 2.3, secondFloorGlassHead - eastTransom.top, mat, { bottom: false });
    }
    if (index === 2) {
      const sidePosts = new THREE.Group();
      sidePosts.name = "三楼两端贴墙角柱";
      g.add(sidePosts);
      // 三楼墙角同样包住正面和侧面，外皮比墙面凸出约15厘米。
      cornerPilaster(sidePosts, elevation.cornerWestX, front - 0.12, base, h - 0.2, mat, -1);
      cornerPilaster(sidePosts, elevation.cornerEastX, front - 0.12, base, h - 0.2, mat, 1);
      const hatPosts = new THREE.Group();
      hatPosts.name = "三楼官帽柱";
      g.add(hatPosts);
      for (const x of elevation.postXs)
        recessedHatPier(hatPosts, x, elevation.postZ, base, elevation.hatEave - base - 0.13, elevation.dividerWidth, mat);
      openingFrame(g, 9.15, base, front - 0.07, 3.2, 2.7, mat, { bottom: false });
      openingFrame(g, 17.95, base, front - 0.07, 2.75, 2.7, mat, { bottom: false });
      openingFrame(g, 13.7, base, front - 0.07, 3.1, 2.55, mat, { bottom: false });
      // 中央后墙以宽玻璃门呈现内退露台的进深，上方沿用效果图1的回纹横披。
      box(g, 13.7, base + 2.91, front - 0.07, 3.25, 0.34, 0.085, mat.trim);
      meander(g, 12.18, base + 2.87, front - 0.13, 3.02, mat);
    }
    // 屋后一二层、二三层交界的白条已去掉。三楼檐口下这一道留在瓦下。
    if (index === 2)
      box(g, 13.55, base + h - 0.16, back + 0.02, 13.56, 0.17, 0.16, mat.trim);
  });
  const portico = new THREE.Group();
  portico.name = "外伸2米的通高门厅";
  group.add(portico);
  const porchFront = m.z - site.portico.projection;
  const columnZ = elevation.porticoColumnZ;
  const columnNorth = columnZ - elevation.porticoColumnDepth / 2;
  for (const post of elevation.balustradePosts.slice(1, 3)) {
    const x = post.x;
    carvedPilaster(portico, x, columnZ, site.entranceRise - 0.02, 7.06 - site.entranceRise, post.w, mat, elevation.porticoColumnDepth, true);
    box(portico, x, 2.85, columnNorth - 0.05, 0.22, 0.9, 0.17, mat.dark);
    box(portico, x, 2.85, columnNorth - 0.145, 0.15, 0.73, 0.025, mat.gold);
    for (const dx of [-0.05, 0.05])
      box(portico, x + dx, 2.85, columnNorth - 0.166, 0.012, 0.72, 0.016, mat.dark);
  }
  // 左右包角柱包住正面与侧面的直角，比两面墙都凸出约15厘米。
  // 柱头停在三楼挑檐三眼皮下面，留出约 8 厘米，避免穿进瓦面。
  const fasciaBottom = apronFasciaBottom(floors[2].y + elevation.eaveParapet, elevation.tiledEaveDrop);
  const frontCornerTop = fasciaBottom - 0.08;
  cornerPilaster(portico, elevation.cornerWestX, m.z - 0.12, 0, frontCornerTop, mat, -1);
  cornerPilaster(portico, elevation.cornerEastX, m.z - 0.12, 0, frontCornerTop, mat, 1);
  // 屋后两根以墙外角为基准。柱函数从这一点再向外凸 15 厘米，后墙和侧墙两面都离开外皮。
  const rearZ = m.z + m.d;
  cornerPilaster(portico, m.x, rearZ, 0, 10.3, mat, -1, 1);
  cornerPilaster(portico, m.x + m.w, rearZ, 0, 10.3, mat, 1, 1);
  // 门厅檐下回纹贴着新的三眼皮。带顶比板底低 5 厘米。高度是造型。
  const band = fasciaBottom - 0.05;
  box(portico, 13.7, band - 0.26, columnNorth + 0.39, 3.7, 0.52, 0.56, mat.trim);
  meander(portico, 11.97, band - 0.33, columnNorth + 0.085, 3.46, mat);
  box(portico, 13.7, band - 0.55, columnNorth + 0.36, 3.35, 0.08, 0.49, mat.trim);
  for (const sign of [-1, 1]) {
    box(portico, 13.7 + sign * 1.76, band - 0.61, columnNorth + 0.4, 0.3, 0.27, 0.46, mat.trim);
    box(portico, 13.7 + sign * 1.62, band - 0.55, columnNorth + 0.4, 0.28, 0.16, 0.46, mat.trim);
  }
  slab(levels[0], rect(site.portico.x, porchFront, site.portico.w, site.portico.projection), 0.015, 0.18, mat.paving).name = "门厅地坪投影另计";
  entranceApproach(portico, mat);
  slab(levels[0], rect(site.annex.x + site.annex.w, circulation.sideDoorZ - circulation.sideDoorWidth / 2,
    m.x - (site.annex.x + site.annex.w), circulation.sideDoorWidth), construction.connectionY, 0.08, mat.paving)
    .name = "横向过道至辅楼的地面连接";
  // 浅阳台位于三层公共过厅外，避免直接放在老人房上方。
  slab(balcony, rect(12.65, 9, 2.5, 1.2), 7.2, 0.18, mat.paving);
  railing(balcony, [12.7, 10.15], [15.1, 10.15], 7.2, mat);
  railing(balcony, [12.7, 9], [12.7, 10.15], 7.2, mat);
  railing(balcony, [15.1, 9], [15.1, 10.15], 7.2, mat);
  balcony.visible = false;

  const a = site.annex;
  slab(annex, rect(a.x, a.z, a.w, a.d), site.entranceRise, 0.18, mat.floor);
  const annexWalls = facades(3);
  for (const facade of annexWalls)
    wallWithOpenings(annex, facade.a, facade.b, 0, 3.6, facade.openings, mat, construction.outsideWall, false, mat.sand);
  sandGrooves(
    annex,
    annexWalls.map((facade) => ({
      a: facade.a,
      b: facade.b,
      base: 0,
      height: 3.6,
      openings: facade.openings,
      includeTop: false,
    })),
    [3.05, 4],
    mat,
    false,
  );
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
  annexFurniture.forEach((f) => furnish(annex, f, site.entranceRise, mat));
  attachRoofs(roof, annexRoof, mat, fenShui);
  // 洞口仍是一二层通高，中间不砌墙。玻璃顶与大门、烤火房对齐，不顶到二楼楼板。
  const curtain = new THREE.Group();
  curtain.name = "挑空客厅一二层通高玻璃";
  group.add(curtain);
  const glassW = 3.07, glassBottom = 0.42, glassTop = secondFloorSideGlassHead;
  const glassH = glassTop - glassBottom;
  const glassMid = (glassBottom + glassTop) / 2;
  box(curtain, 9.15, glassMid, -0.815, glassW, glassH, 0.02, mat.glass, false);
  const bar = 0.05;
  const glassLeft = 9.15 - glassW / 2;
  for (const t of [1 / 3, 2 / 3])
    box(curtain, glassLeft + glassW * t, glassMid, -0.88, bar, glassH, 0.08, mat.dark, false);
  for (const y of [glassBottom + (3.6 - glassBottom) / 2, 3.6, 3.6 + (glassTop - 3.6) / 2])
    box(curtain, 9.15, y, -0.88, glassW, bar, 0.08, mat.dark, false);
  entryScreen(group, mat);
  eastMeanderBand(group, mat);
  return { group, levels, roof, balcony, annex, annexRoof, portico, labels };
}

// 正屋前、左、右各出 80cm；天沟外缘即尺寸控制线。主辅楼四坡共用一个分水。
export function mainRoofFootprint() {
  const m = site.main;
  const z = floors[2].front - site.thirdEave;
  return {
    x: m.x - site.thirdEave,
    z,
    w: m.w + 2 * site.thirdEave,
    d: m.z + m.d + site.eave - z,
    eave: 10.5,
  };
}

export const annexRoofFootprint = { x: 0.25, z: -1.55, w: 5.6, d: 11.1, eave: 3.6 };

export function roofPitch(fenShui: number) {
  const main = mainRoofFootprint();
  return {
    fenShui,
    mainRun: (Math.min(main.w, main.d) - 0.56) / 2,
    annexRun: (Math.min(annexRoofFootprint.w, annexRoofFootprint.d) - 0.56) / 2,
    mainRise: hipRise(main.w, main.d, fenShui),
    annexRise: hipRise(annexRoofFootprint.w, annexRoofFootprint.d, fenShui),
  };
}

export function attachRoofs(
  roof: THREE.Object3D,
  annexRoof: THREE.Object3D,
  mat: Mats,
  fenShui = site.roofFenShui,
) {
  const main = mainRoofFootprint();
  const pitch = roofPitch(fenShui);
  const hatCenter = site.portico.x + site.portico.w / 2;
  const mainRoof = gutteredRoof(roof, main.x, main.z, main.w, main.d, main.eave, pitch.mainRise, mat, {
    x: hatCenter - frontElevation.hatWidth / 2,
    w: frontElevation.hatWidth,
    z: frontElevation.hatFront,
  });
  mainRoof.name = "正屋四坡";
  const mainPeak = main.eave + 0.08 + pitch.mainRise;
  const mainRidgeZ = main.z + main.d / 2;
  const hat = projectingHatRoof(
    roof, hatCenter, frontElevation.hatFront, frontElevation.hatWidth,
    mainRidgeZ, main.eave, mainPeak, mat,
  );
  box(hat, 13.7, frontElevation.hatEave - 0.2, frontElevation.postZ, 4.5, 0.3, 0.56, mat.trim);
  meander(hat, 11.9, frontElevation.hatEave - 0.24, frontElevation.postZ - 0.3, 3.6, mat);
  const annex = annexRoofFootprint;
  gutteredRoof(annexRoof, annex.x, annex.z, annex.w, annex.d, annex.eave, pitch.annexRise, mat);
  box(annexRoof, 1.65, 4.95, 7.95, 0.46, 3.1, 0.46, mat.stone);
  box(annexRoof, 1.65, 6.57, 7.95, 0.72, 0.12, 0.72, mat.dark);
  for (const x of [1.45, 1.85])
    box(annexRoof, x, 6.37, 7.95, 0.045, 0.32, 0.045, mat.metal);
}
