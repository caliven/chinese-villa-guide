import * as THREE from "three";
import { site, frontFieldLevel, contains, type Point } from "./data";
import { box, type Mats } from "./primitives";
import { betweenContours, contourAt, contourSection } from "./contours";
import { subtractRoofPolygon } from "./roof-surfaces";
import {
  surroundings as c,
  groundHeight,
  roadStations,
  roadHeight,
  rightTerraceBreak,
  terraceContours as edges,
  villageRoadEdges,
} from "./surroundings";

function surface(
  parent: THREE.Object3D,
  name: string,
  points: Point[],
  y: number,
  material: THREE.Material,
) {
  const shape = new THREE.Shape(
    points.map(([x, z]) => new THREE.Vector2(x, -z)),
  );
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < uv.count; i++)
    uv.setXY(i, uv.getX(i) / 30, uv.getY(i) / 30);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.y = y;
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

// 只生成高差处的立面，不用重叠的大盒子叠台地，避免共享面闪烁。
function riser(
  parent: THREE.Object3D,
  points: Point[],
  top: number,
  bottom: number | ((x: number, z: number) => number),
  mat: Mats,
) {
  const vertices: number[] = [],
    uv: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    const ya = typeof bottom === "number" ? bottom : bottom(...a);
    const yb = typeof bottom === "number" ? bottom : bottom(...b);
    const quad = [
      [a[0], ya, a[1]],
      [b[0], yb, b[1]],
      [b[0], top, b[1]],
      [a[0], top, a[1]],
    ];
    for (const index of [0, 1, 2, 0, 2, 3]) {
      vertices.push(...quad[index]);
      uv.push(quad[index][0] / 8 + quad[index][2] / 8, quad[index][1] / 8);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
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
) {
  const xs = polygon.map((p) => p[0]),
    zs = polygon.map((p) => p[1]);
  const material = mat.grass.clone();
  material.color.set(0x75864d);
  for (let x = Math.min(...xs) + 800; x < Math.max(...xs) - 500; x += 1250) {
    for (let z = Math.min(...zs) + 600; z < Math.max(...zs) - 700; z += 2200) {
      if (!contains([x, z], polygon) || !contains([x, z + 1700], polygon))
        continue;
      box(parent, x, y + 35, z + 850, 130, 70, 1700, material, false);
    }
  }
}

export function buildContextGround(mat: Mats) {
  const group = new THREE.Group();
  group.name = "红线曲线梯田";
  const left = -55000, right = 77000, roadRight = c.road.x + c.road.w;
  const levelLine = (z: number): Point[] => [[left, z], [right, z]];
  const villageFront: Point[] = [[left, villageRoadEdges.front[0][1]], ...villageRoadEdges.front, [right, villageRoadEdges.front.at(-1)![1]]];
  const villageBack: Point[] = [[left, villageRoadEdges.back[0][1]], ...villageRoadEdges.back, [right, villageRoadEdges.back.at(-1)![1]]];
  /** 田面与弯曲主马路重叠时挖空路廊，避免更高田面把路面盖住。 */
  const paintBand = (name: string, polygon: Point[], y: number, crops: boolean, cutVillageRoad: boolean) => {
    const parts = cutVillageRoad
      ? subtractRoofPolygon(polygon, villageRoadEdges.outline).filter((part) => part.length >= 3 && Math.abs(area2(part)) > 500000)
      : [polygon];
    parts.forEach((part, index) => {
      const label = parts.length > 1 ? `${name}·${index + 1}` : name;
      surface(group, label, part, y, mat.grass);
      if (crops) cropRows(group, part, y, mat);
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
  // 木屋前院坪已与两侧拉平。屋基和前坪用同一块铺装，关掉整栋后不会露出一块褐色补丁。
  surface(group, "左侧邻居木房地基", betweenContours(levelLine(c.sideHouse.z), edges.rearFirst, site.width, c.road.x), 0, mat.paving);
  // 木屋前地下室属于自家。土坎只留在地库地面以下，上面留给地库外墙，避免把外侧封死。
  riser(group, [[site.width, c.neighborYard.z], [c.road.x, c.neighborYard.z]], site.garageFloor, frontFieldLevel, mat);

  band("道路左侧外伸高地", edges.leftPlatform, edges.rearFirst, roadRight, right, c.leftPlatform.y, true);
  band("高地前方低田", villageBack, edges.leftPlatform, roadRight, right, c.frontHouse.y);
  riser(group, edges.leftPlatform, c.leftPlatform.y, c.frontHouse.y, mat);

  // 后田按各自的弯曲外沿拼接；后方木房仍完整坐落在第二层田面上。
  // 马路东侧红框内不再分级，从高地一直平到山脚。
  band("屋后第一层曲线梯田", edges.rearFirst, edges.rearSecond, left, c.road.x, c.rearFirst.y, true);
  band("后方木房所在第二层梯田", edges.rearSecond, edges.rearThird, left, c.road.x, c.rearSecond.y);
  riser(group, contourSection(edges.rearSecond, left, c.road.x), c.rearSecond.y, c.rearFirst.y, mat);
  band("道路东侧平地", edges.rearFirst, edges.hillFoot, roadRight, right, c.leftPlatform.y, true);
  // 路面停在这一层。原路床并入同一平面，屋后木房左侧不再留一段往上走的路。
  band(
    "马路尽头并入大平地",
    [[c.road.x, c.road.back], [roadRight, c.road.back]],
    edges.hillFoot,
    c.road.x,
    roadRight,
    c.leftPlatform.y,
  );
  // 屋后自家段已有石砌挡墙，其余田坎使用同一条曲线的分段。
  for (const [from, to, lower] of [[left, 0, 0], [site.width, c.road.x, 0]]) {
    riser(group, contourSection(edges.rearFirst, from, to), c.rearFirst.y, lower, mat);
  }
  const roadEdge = (fromZ: number, toZ: number, top: number) =>
    riser(group, [[c.road.x, fromZ], [c.road.x, toZ]], top, c.leftPlatform.y, mat);
  roadEdge(contourAt(edges.rearSecond, c.road.x), contourAt(edges.rearThird, c.road.x), c.rearSecond.y);
  roadEdge(contourAt(edges.rearThird, c.road.x), contourAt(edges.hillFoot, c.road.x), c.rearThird.y);
  cropRows(group, betweenContours(edges.rearSecond, edges.rearThird, left, c.rearHouse.x - 1000), c.rearSecond.y, mat);
  band("后山前第三层曲线梯田", edges.rearThird, edges.hillFoot, left, c.road.x, c.rearThird.y, true);
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
  roadBank(roadRight, c.road.front, contourAt(edges.leftPlatform, roadRight), c.frontHouse.y);
  roadBank(roadRight, contourAt(edges.leftPlatform, roadRight), c.road.back, c.leftPlatform.y);

  // 连续曲线一直延伸到远田，不再使用格子状高低跳变拼出远近接缝。
  band("村道外前方地面", levelLine(-45000), villageFront, left, right, c.frontHouse.y, false, true);
  band("横向村道右侧田面", villageFront, villageBack, left, c.extent.left, c.frontHouse.y, false, true);
  band("横向村道左侧田面", villageFront, villageBack, c.extent.right, right, c.frontHouse.y, false, true);

  // 山坡第一排顶点直接采用末级田埂，之后才逐渐抬高。
  const positions: number[] = [], uv: number[] = [];
  const hill = edges.hillFoot, rows = 32;
  for (let i = 1; i < hill.length; i++) {
    const a = hill[i - 1], b = hill[i];
    const point = (p: Point, row: number) => {
      const z = p[1] + (87000 - p[1]) * row / rows;
      return [p[0], groundHeight(p[0], z), z];
    };
    for (let j = 1; j <= rows; j++) {
      const quad = [point(a, j - 1), point(b, j - 1), point(b, j), point(a, j)];
      for (const index of [0, 2, 1, 0, 3, 2]) {
        positions.push(...quad[index]);
        uv.push(quad[index][0] / 30, quad[index][2] / 30);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  const mountain = new THREE.Mesh(geometry, mat.grass);
  mountain.name = "曲线山脚后的连续后山";
  mountain.castShadow = mountain.receiveShadow = true;
  group.add(mountain);
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
  surface(
    road,
    "蓝顶邻房门前弯曲主马路",
    villageRoadEdges.outline,
    c.frontHouse.y + 50,
    villageMat,
  );
  return road;
}
