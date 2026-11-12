import * as THREE from "three";
import { site, frontFieldLevel, contains, courtyardFront, NEIGHBOR_COURTYARD_SLAB_THICKNESS, type Point } from "./data";
import { box, type Mats } from "./primitives";
import { betweenContours, contourAt, contourSection } from "./contours";
import { intersectRoofPolygon, subtractRoofPolygon } from "./roof-surfaces";
import { basementFloorY } from "./garage-layout";
import { mountainColor } from "./terrain-horizon";
import { buildEasternGround } from "./site-east-ground";
import { terrainSurfaceGeometry } from "./site-surface-geometry";
import { distanceToPhotoPath } from "./photo-context-layout";
import {
  surroundings as c,
  handmadeTerrainBounds,
  createLocalTerrainSampler,
  createEasternTerrainSampler,
  TERRAIN_JOIN_GRID_STEP_MM,
  roadStations,
  roadHeight,
  rightTerraceBreak,
  terraceContours as edges,
  villageRoadEdges,
  northPhotoLayout,
} from "./surroundings";

type TerrainSampler = ReturnType<typeof createLocalTerrainSampler>;

/** 立面随田面在所有网格边／对角线处断开，避免长边横跨弯曲坡面。 */
function terrainEdgeStations(x: number, z: number, dx: number, dz: number, from: number, to: number) {
  const stations = [from, to], step = TERRAIN_JOIN_GRID_STEP_MM;
  for (const [origin, direction] of [[x, dx], [z, dz], [x - z, dx - dz]]) {
    if (Math.abs(direction) < 1e-9) continue;
    const a = origin + direction * from, b = origin + direction * to;
    for (let value = Math.ceil(Math.min(a, b) / step) * step; value < Math.max(a, b); value += step) {
      const t = (value - origin) / direction;
      if (t > from + 1e-9 && t < to - 1e-9) stations.push(t);
    }
  }
  return [...new Set(stations)].sort((a, b) => a - b);
}

function surface(
  parent: THREE.Object3D,
  name: string,
  points: Point[],
  y: number,
  material: THREE.Material,
  uvMode: "scaled" | "plan" = "scaled",
  sample?: TerrainSampler,
  terrainColor = false,
) {
  const shape = new THREE.Shape(
    points.map(([x, z]) => new THREE.Vector2(x, -z)),
  );
  const geometry = sample ? terrainSurfaceGeometry(points, (x, z) => sample(x, z, y).heightMm) : new THREE.ShapeGeometry(shape);
  if (!sample) geometry.rotateX(-Math.PI / 2);
  const uv = geometry.getAttribute("uv");
  if (uvMode === "plan") {
    // 与院坪厚板顶面同一套平面坐标，水泥／地砖接缝能对上。
    const pos = geometry.getAttribute("position");
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i), -pos.getZ(i));
  } else if (!sample) {
    for (let i = 0; i < uv.count; i++)
      uv.setXY(i, uv.getX(i) / 30, uv.getY(i) / 30);
  }
  if (sample && terrainColor && material instanceof THREE.MeshStandardMaterial) {
    const colored = material.clone();
    colored.color.set(0xffffff);
    colored.map = null;
    colored.vertexColors = true;
    colored.roughness = 0.96;
    colored.envMapIntensity = 0.18;
    const colors: number[] = [], positions = geometry.getAttribute("position");
    const rivers = name.startsWith("村道外前方地面") ? northPhotoLayout().courses : [];
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), z = positions.getZ(i);
      const weight = sample(x, z, y).demWeight;
      const color = material.color.clone().lerp(mountainColor(positions.getY(i) / 1000, 0), weight);
      for (const river of rivers) {
        const distance = distanceToPhotoPath(x, z, river.points).distance;
        const gravel = Math.max(0, Math.min(1, (river.halfWidth + 1000 - distance) / 2000));
        color.lerp(new THREE.Color(0x989783), gravel * (1 - weight));
      }
      colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    material = colored;
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.y = sample ? 0 : y;
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

// 只生成高差处的立面，不用重叠的大盒子叠台地，避免共享面闪烁。
function riser(
  parent: THREE.Object3D,
  points: Point[],
  top: number | ((x: number, z: number) => number),
  bottom: number | ((x: number, z: number) => number),
  mat: Mats,
  adjust = true,
) {
  const positions: number[] = [];
  const indices: number[] = [];
  const uv: number[] = [];
  const bounds = handmadeTerrainBounds();
  const sample = createLocalTerrainSampler();
  // 逐段裁到近场外沿，保留弯曲田坎的原始端点与标高。
  for (let i = 1; i < points.length; i++) {
    const [x, z] = points[i - 1], dx = points[i][0] - x, dz = points[i][1] - z;
    let from = 0, to = 1;
    for (const [position, direction, min, max] of [[x, dx, bounds.left, bounds.right], [z, dz, bounds.front, bounds.back]]) {
      if (Math.abs(direction) < 1e-9) {
        if (position < min || position > max) to = -1;
        continue;
      }
      const a = (min - position) / direction, b = (max - position) / direction;
      from = Math.max(from, Math.min(a, b));
      to = Math.min(to, Math.max(a, b));
    }
    if (to <= from) continue;
    const stations = terrainEdgeStations(x, z, dx, dz, from, to);
    const base = positions.length / 3;
    for (const t of stations) {
      const px = x + dx * t, pz = z + dz * t;
      const baseBottom = typeof bottom === "number" ? bottom : bottom(px, pz);
      const baseTop = typeof top === "number" ? top : top(px, pz);
      const yBottom = adjust ? sample(px, pz, baseBottom).heightMm : baseBottom;
      const yTop = adjust ? sample(px, pz, baseTop).heightMm : baseTop;
      positions.push(px, yBottom, pz, px, yTop, pz);
      uv.push(px / 8 + pz / 8, yBottom / 8, px / 8 + pz / 8, yTop / 8);
    }
    for (let j = 1; j < stations.length; j++) {
      const a = base + (j - 1) * 2, b = base + j * 2;
      indices.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }
  if (!indices.length) return;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = mat.soil.clone();
  material.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "梯田高差立面";
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
}

function cropRows(
  parent: THREE.Object3D,
  polygon: Point[],
  y: number,
  mat: Mats,
  sample: TerrainSampler,
) {
  if (polygon.length < 3) return;
  const xs = polygon.map((p) => p[0]),
    zs = polygon.map((p) => p[1]);
  const material = mat.grass.clone();
  material.color.set(0x75864d);
  // 固定到场地坐标，裁切外围或调整地块大小时，近房作物条带保持原位。
  const firstX = Math.ceil(Math.min(...xs) / 1250) * 1250 + 800;
  const firstZ = Math.ceil(Math.min(...zs) / 2200) * 2200 + 600;
  for (let x = firstX; x < Math.max(...xs) - 500; x += 1250) {
    for (let z = firstZ; z < Math.max(...zs) - 700; z += 2200) {
      if (!contains([x, z], polygon) || !contains([x, z + 1700], polygon))
        continue;
      // 外围已转为自然坡面，作物仅保留在近房平整田面，避免条块悬空。
      if ([[x - 65, z], [x + 65, z], [x - 65, z + 1700], [x + 65, z + 1700]]
        .some(([px, pz]) => sample(px, pz, y).demWeight > 1e-8)) continue;
      box(parent, x, y + 35, z + 850, 130, 70, 1700, material, false);
    }
  }
}

export function buildContextGround(mat: Mats) {
  const group = new THREE.Group();
  group.name = "红线曲线梯田";
  const bounds = handmadeTerrainBounds();
  const sample = createLocalTerrainSampler();
  const { left, right, front, back } = bounds;
  const roadRight = c.road.x + c.road.w;
  const levelLine = (z: number): Point[] => [[left, z], [right, z]];
  const villageFront = contourSection(villageRoadEdges.front, left, right);
  const villageBack = contourSection(villageRoadEdges.back, left, right);
  /** 田面与弯曲主马路重叠时挖空路廊，避免更高田面把路面盖住。 */
  const paintBand = (name: string, polygon: Point[], y: number, crops: boolean, cutVillageRoad: boolean) => {
    polygon = intersectRoofPolygon(polygon, [[left, front], [roadRight, front], [roadRight, back], [left, back]]);
    if (polygon.length < 3) return;
    // 弯道路廊会切出细小有效地块，面积阈值只剔除退化面，避免留下贯穿孔洞。
    const parts = cutVillageRoad
      ? subtractRoofPolygon(polygon, villageRoadEdges.outline).filter((part) => part.length >= 3 && Math.abs(area2(part)) > 0.01)
      : [polygon];
    parts.forEach((part, index) => {
      const label = parts.length > 1 ? `${name}·${index + 1}` : name;
      surface(group, label, part, y, mat.grass, "scaled", sample, true);
      if (crops) cropRows(group, part, y, mat, sample);
    });
  };
  const band = (
    name: string,
    front: Point[],
    back: Point[],
    from: number,
    to: number,
    y: number,
    crops = false,
    cutVillageRoad = false,
  ) => {
    from = Math.max(left, from);
    to = Math.min(right, to);
    if (to <= from) return [];
    const polygon = betweenContours(front, back, from, to);
    paintBand(name, polygon, y, crops, cutVillageRoad);
    return polygon;
  };

  // 右侧原田面向房前展开，田埂在 X=0 与地库外沿连续相接。
  // 旁田未开挖，所以它的高度单独取值，绝不绑定地库完成面。
  band("辅楼右侧上田·与院坪齐平", rightTerraceBreak, edges.rearFirst, left, 0, 0, true);
  band("辅楼右侧原田·未开挖", edges.sharedFront, rightTerraceBreak, left, 0, site.adjacentUnexcavatedLevel, true);
  riser(group, rightTerraceBreak, 0, site.adjacentUnexcavatedLevel, mat);
  riser(group, contourSection(edges.sharedFront, left, 0), site.adjacentUnexcavatedLevel, frontFieldLevel, mat);

  // 前方低田横向接通；下一层外沿独立描画，不再使用固定 Z=-12 的直线。
  // 与蓝顶房前弯曲主马路重叠处挖空，否则 −4.95 田面盖住 −6.45 路面。
  band("地库外侧弯曲低田", edges.frontLower, edges.sharedFront, left, c.road.x, frontFieldLevel, true, true);
  band("前方砖房及蓝顶邻房台地", villageBack, edges.frontLower, left, c.road.x, c.frontHouse.y, false, true);
  riser(group, edges.frontLower, frontFieldLevel, c.frontHouse.y, mat);
  // 砖房后墙距田坎有一段窄田，路侧也要封住这段高差；否则从道路侧
  // 可以透过空心台地看到低于田面的白色房墙。
  riser(group, [[c.road.x, c.frontHouse.z + c.frontHouse.d], [c.road.x, contourAt(edges.frontLower, c.road.x)]], frontFieldLevel, c.frontHouse.y, mat);
  // 木屋前院坪已与两侧拉平。屋基以及贴着木房西墙的过道用邻居院坪，关掉整栋后仍是同一块铺装。
  const woodBase = surface(
    group,
    "左侧邻居木房地基",
    betweenContours(levelLine(c.sideHouse.z), edges.rearFirst, site.width, c.road.x),
    0,
    mat.neighborCourtyard,
    "plan",
  );
  woodBase.castShadow = false;
  // 地库外沿土坎：从自家东界略叠入接上石基，再经斜坡接到马路，一张立面。
  // 顶随水泥板底走（含斜坡）；平面略外移，避免与矮墙外皮共面闪绿。
  {
    const ownThick = Math.max(120, site.garageSlabThickness || 150);
    const neighborThick = NEIGHBOR_COURTYARD_SLAB_THICKNESS;
    const startX = site.width - 400;
    const endX = c.road.x;
    const samples = Math.max(48, Math.ceil((endX - startX) / 120));
    // 土坎立面相对院坪外沿再向外（Z 减小）一点，与 18 墙外皮错开。
    const riserOutset = 40;
    const path: Point[] = Array.from({ length: samples + 1 }, (_, i) => {
      const x = startX + ((endX - startX) * i) / samples;
      const z = x <= site.width
        ? contourAt(courtyardFront, x)
        : c.neighborYard.z;
      return [x, z - riserOutset] as Point;
    });
    const soil = mat.soil.clone();
    soil.polygonOffset = true;
    soil.polygonOffsetFactor = 2;
    soil.polygonOffsetUnits = 2;
    riser(
      group,
      path,
      (x, z) => basementFloorY(x, z + riserOutset) - (x >= c.neighborYard.x ? neighborThick : ownThick) - 10,
      frontFieldLevel,
      { ...mat, soil },
    );
  }

  // 后田按各自的弯曲外沿拼接；后方木房仍完整坐落在第二层田面上。
  // 东侧另用连续坡面，西侧近房仍保留已定位的梯田。
  band("屋后第一层曲线梯田", edges.rearFirst, edges.rearSecond, left, c.road.x, c.rearFirst.y, true);
  band("后方木房所在第二层梯田", edges.rearSecond, edges.rearThird, left, c.road.x, c.rearSecond.y);
  riser(group, contourSection(edges.rearSecond, left, c.road.x), c.rearSecond.y, c.rearFirst.y, mat);
  // 屋后自家段已有石砌挡墙，其余田坎使用同一条曲线的分段。
  for (const [from, to, lower] of [[left, 0, 0], [site.width, c.road.x, 0]]) {
    riser(group, contourSection(edges.rearFirst, from, to), c.rearFirst.y, lower, mat);
  }
  const eastern = createEasternTerrainSampler();
  const roadEdge = (fromZ: number, toZ: number, top: number) => {
    if (toZ <= fromZ) return;
    const path: Point[] = [fromZ, ...eastern.zs.filter(z => z > fromZ && z < toZ), toZ].map(z => [c.road.x, z]);
    riser(group, path, (x, z) => sample(x, z, top).heightMm,
      (x, z) => eastern.sample(x, z).heightMm, mat, false);
  };
  const rearStart = Math.max(c.road.back, contourAt(edges.rearFirst, c.road.x));
  roadEdge(c.road.back, rearStart, 0);
  roadEdge(rearStart, contourAt(edges.rearSecond, c.road.x), c.rearFirst.y);
  roadEdge(contourAt(edges.rearSecond, c.road.x), contourAt(edges.rearThird, c.road.x), c.rearSecond.y);
  roadEdge(contourAt(edges.rearThird, c.road.x), back, c.rearThird.y);
  cropRows(group, betweenContours(edges.rearSecond, edges.rearThird, left, c.rearHouse.x - 1000), c.rearSecond.y, mat, sample);
  band("后山前第三层曲线梯田", edges.rearThird, levelLine(back), left, c.road.x, c.rearThird.y, true);
  riser(group, contourSection(edges.rearThird, left, c.road.x), c.rearThird.y, c.rearSecond.y, mat);

  // 道路边线始终留空。只补地形与道路之间的侧立面，不在路面下再铺一张共面田面。
  const roadBank = (x: number, from: number, to: number, y: number) => {
    const zs = [from, ...roadStations.map(([z]) => z).filter(z => z > from && z < to), to];
    riser(group, zs.map((z): Point => [x, z]), y, (_x, z) => roadHeight(z), mat);
  };
  const frontLeft = contourAt(edges.frontLower, c.road.x);
  roadBank(c.road.x, c.road.front, frontLeft, c.frontHouse.y);
  roadBank(c.road.x, frontLeft, c.neighborYard.z, frontFieldLevel);
  // 邻居地库靠马路一侧是空的，不在这段路和地库之间砌挡墙。
  // 木房侧墙就在道路边线上，这段由房墙遮挡路床；不再叠一张同位置的土立面。
  roadBank(c.road.x, c.sideHouse.z + c.sideHouse.d, c.road.back, 0);

  // 连续曲线一直延伸到远田，不再使用格子状高低跳变拼出远近接缝。
  band("村道外前方地面", levelLine(front), villageFront, left, right, c.frontHouse.y, false, true);
  band("横向村道右侧田面", villageFront, villageBack, left, c.extent.left, c.frontHouse.y, false, true);
  band("横向村道左侧田面", villageFront, villageBack, c.extent.right, right, c.frontHouse.y, false, true);

  group.add(buildEasternGround(mat));
  return group;
}

function area2(points: Point[]) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, z1] = points[i],
      [x2, z2] = points[(i + 1) % points.length];
    sum += x1 * z2 - x2 * z1;
  }
  return sum / 2;
}

export function buildRoad(mat: Mats) {
  const road = new THREE.Group();
  road.name = "邻居木房左侧道路";
  const { x, w } = c.road;
  const vertices: number[] = [],
    uv: number[] = [];
  for (let i = 1; i < roadStations.length; i++) {
    const [a, ya] = roadStations[i - 1],
      [b, yb] = roadStations[i];
    const quad = [
      [x, ya, a],
      [x + w, ya, a],
      [x + w, yb, b],
      [x, yb, b],
    ];
    for (const index of [0, 2, 1, 0, 3, 2]) {
      vertices.push(...quad[index]);
      uv.push(quad[index][0] / 8, quad[index][2] / 8);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  // 略深的路面色，和邻房浅色前坪区分开。
  const material = mat.paving.clone();
  material.color = new THREE.Color(0x8f8d82);
  material.side = THREE.DoubleSide;
  const strip = new THREE.Mesh(geometry, material);
  strip.name = "连续路面·无重复铺面";
  strip.receiveShadow = true;
  road.add(strip);
  // 西段沿蓝顶邻房门前转弯，东段仍接原来的 T 形路口。
  // 略抬高避免与台地共面闪烁；田面已在路廊挖空。
  const villageMat = mat.paving.clone();
  villageMat.color = new THREE.Color(0x8f8d82);
  const { left, front, back } = handmadeTerrainBounds();
  surface(
    road,
    "蓝顶邻房门前弯曲主马路",
    intersectRoofPolygon(villageRoadEdges.outline, [[left, front], [c.road.x + c.road.w, front], [c.road.x + c.road.w, back], [left, back]]),
    c.frontHouse.y + 50,
    villageMat,
    "scaled",
    createLocalTerrainSampler(),
  );
  return road;
}
