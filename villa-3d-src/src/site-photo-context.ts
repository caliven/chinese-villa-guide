import * as THREE from "three";
import { type Point } from "./data";
import { box, slab, rect, type Mats } from "./primitives";
import { intersectRoofPolygon, subtractRoofPolygon } from "./roof-surfaces";
import { groundHeight, northPhotoLayout, surroundings, villageRoadEdges, villageRoadElevation } from "./surroundings";
import { northCreekSection, northPhotoReferences } from "./photo-context-layout";
import { terrainSurfaceGeometry } from "./site-surface-geometry";
import { contourAt, contourSection } from "./contours";

function pathOutline(points: Point[], width: number) {
  const left: Point[] = [], right: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dx = -(b[1] - a[1]) / length * width / 2;
    const dz = (b[0] - a[0]) / length * width / 2;
    left.push([points[i][0] + dx, points[i][1] + dz]);
    right.push([points[i][0] - dx, points[i][1] - dz]);
  }
  return [...left, ...right.reverse()];
}

export function buildNorthPhotoContext(mat: Mats) {
  const group = new THREE.Group();
  group.name = "北侧双溪与桥路";
  group.userData = { source: northPhotoReferences, accuracy: "岸线、河床高差及桥跨尺寸为照片估算，流向由用户确认向西" };
  const { bridge, approach, courses } = northPhotoLayout();
  const waterMaterial = new THREE.MeshStandardMaterial({ color: 0x46645c, roughness: 0.32, metalness: 0.05 });
  const waterCovers: Point[][] = [];
  for (const course of courses) {
    const outline = pathOutline(course.points, course.wetWidth);
    const triangles = THREE.ShapeUtils.triangulateShape(outline.map(([x, z]) => new THREE.Vector2(x, z)), [])
      .map(ids => ids.map(index => outline[index]))
      .filter(([a, b, c]) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) > 0.02);
    const positions: number[] = [];
    for (const triangle of triangles) {
      let parts = [triangle];
      // 汇合处两条水带裁开，共享水面不重叠。
      for (const cover of waterCovers) {
        if (!intersectRoofPolygon(triangle, cover).length) continue;
        parts = parts.flatMap(part => subtractRoofPolygon(part, cover));
      }
      for (const part of parts) {
        const clipped = terrainSurfaceGeometry(part, (x, z) => groundHeight(x, z) + 75, 1000);
        const p = clipped.getAttribute("position"), indices = clipped.getIndex()!;
        for (let i = 0; i < indices.count; i++) {
          const index = indices.getX(i);
          positions.push(p.getX(index), p.getY(index), p.getZ(index));
        }
        clipped.dispose();
      }
    }
    waterCovers.push(...triangles);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, waterMaterial);
    mesh.name = course.name;
    mesh.receiveShadow = true;
    mesh.userData.flowDirection = "过桥洞汇合后向西";
    group.add(mesh);
  }

  let seed = 82173;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const rockMaterial = mat.stone.clone();
  rockMaterial.map = null;
  rockMaterial.color.set(0x92918a);
  const stones = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), rockMaterial, 240);
  stones.name = "双溪裸露卵石与块石·示意分布";
  stones.castShadow = stones.receiveShadow = true;
  const transform = new THREE.Object3D();
  for (let i = 0; i < stones.count; i++) {
    const course = courses[i % courses.length];
    const station = Math.floor(random() * (course.points.length - 1));
    const a = course.points[station], b = course.points[station + 1];
    const t = random(), side = (random() - 0.5) * course.halfWidth * 1.6;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const x = a[0] + (b[0] - a[0]) * t - (b[1] - a[1]) / length * side;
    const z = a[1] + (b[1] - a[1]) * t + (b[0] - a[0]) / length * side;
    const size = 260 + random() * 900;
    transform.position.set(x, groundHeight(x, z) + size * 0.2, z);
    transform.rotation.set(random() * 0.4, random() * Math.PI, random() * 0.4);
    transform.scale.set(size, size * (0.32 + random() * 0.3), size * (0.6 + random() * 0.6));
    transform.updateMatrix();
    stones.setMatrixAt(i, transform.matrix);
  }
  group.add(stones);

  const bridgeGroup = new THREE.Group();
  bridgeGroup.name = "蓝顶邻房前跨溪桥";
  const [northWest, northEast, southEast, southWest] = bridge.deck;
  slab(bridgeGroup, bridge.deck, bridge.top, 450, mat.paving).name = "桥面·桥下贯通";
  const along = (a: Point, b: Point, y: number, height: number, thickness: number, depthPad = 0) => {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const length = Math.hypot(dx, dz);
    const mesh = box(bridgeGroup, (a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2, thickness, height, length + depthPad, mat.stone);
    mesh.rotation.y = Math.atan2(dx, dz);
    return mesh;
  };
  // 栏墙顺着斜桥布置，桥下无横向填土封堵。
  for (const [a, b] of [[southWest, northWest], [southEast, northEast]] as [Point, Point][]) {
    along(a, b, bridge.top + 440, 880, 220);
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
    for (let distance = 300; distance < length - 300; distance += 1800) {
      const t = distance / length;
      box(bridgeGroup, a[0] + dx * t, bridge.top + 920, a[1] + dz * t, 360, 120, 450, mat.trim)
        .rotation.y = Math.atan2(dx, dz);
    }
  }
  along(southWest, southEast, bridge.top - 1250, 1600, 800, 600);
  along(northWest, northEast, bridge.top - 1250, 1600, 800, 600);
  // 西侧并入蓝顶房前路，东侧斜接前方邻房前的村道；引道向路心多伸一段，补上斜桥西侧与路缘之间的断口。
  const roadWest = Math.min(southWest[0], southEast[0]) - 9000;
  const roadEast = Math.max(southWest[0], southEast[0]) + 5500;
  const frontJoin = contourSection(villageRoadEdges.front, roadWest, roadEast);
  const intoRoad = frontJoin.map(([x, z]) => {
    const backZ = contourAt(villageRoadEdges.back, x);
    return [x, z + (backZ - z) * 0.55] as Point;
  });
  const westCorner = southWest[0] < southEast[0] ? southWest : southEast;
  const eastCorner = southWest[0] < southEast[0] ? southEast : southWest;
  const junction: Point[] = [
    westCorner,
    eastCorner,
    ...intoRoad.slice().reverse(),
  ];
  // 引道顶面略高于村道（村道为 frontHouse.y+50），避免伸进路心后共面闪线。
  slab(group, junction, bridge.top - 10, 450, mat.paving).name = "蓝顶邻房门前道路交叉引道";
  // 近桥端路面贴桥面标高，远端再随地形，避免北侧接入路中间塌进河床。
  const approachMesh = (() => {
    const geometry = terrainSurfaceGeometry(pathOutline(approach, bridge.width), (x, z) => {
      const along = Math.max(0, bridge.north[1] - z);
      const grade = Math.min(1, along / 12000);
      return (bridge.top + 25) * (1 - grade) + (groundHeight(x, z) + 75) * grade;
    }, 1000);
    const mesh = new THREE.Mesh(geometry, mat.paving);
    mesh.name = "北侧过桥接入路";
    mesh.receiveShadow = mesh.castShadow = true;
    return mesh;
  })();
  group.add(bridgeGroup, approachMesh);

  const small = courses[0].points.find(point => point[0] < 76000)!;
  const smallRoadZ = contourAt(villageRoadEdges.front, small[0]);
  const smallSection = northCreekSection(small[0], smallRoadZ, villageRoadElevation(small[0]));
  const smallEnd = smallSection.centerZ - smallSection.halfWidth - 3500;
  const smallTop = villageRoadElevation(small[0]) + 75;
  const footbridge = slab(group, rect(small[0] - 650, smallEnd, 1300, smallRoadZ - smallEnd),
    smallTop, 220, mat.paving);
  footbridge.name = "东侧支溪便桥";
  for (const z of [smallRoadZ - 400, smallEnd + 400]) {
    const bottom = groundHeight(small[0], z) - 200;
    box(group, small[0], (smallTop - 220 + bottom) / 2, z, 1500, smallTop - 220 - bottom, 700, mat.stone);
  }
  const bankPositions: number[] = [];
  for (let x = bridge.x - 12000; x < bridge.x + 32000; x += 1500) {
    if (Math.abs(x + 750 - bridge.x) < bridge.width / 2 + 1200) continue;
    const quad = [x, x + 1500].flatMap(px => {
      const z = contourAt(villageRoadEdges.front, px);
      return [[px, surroundings.frontHouse.y + 25, z - 700], [px, groundHeight(px, z - 2500) + 25, z - 2500]];
    });
    for (const index of [0, 1, 2, 1, 3, 2]) bankPositions.push(...quad[index]);
  }
  const bankGeometry = new THREE.BufferGeometry();
  bankGeometry.setAttribute("position", new THREE.Float32BufferAttribute(bankPositions, 3));
  bankGeometry.computeVertexNormals();
  const bankMaterial = mat.stone.clone();
  bankMaterial.map = null;
  bankMaterial.side = THREE.DoubleSide;
  const bank = new THREE.Mesh(bankGeometry, bankMaterial);
  bank.name = "沿溪村道石砌护岸";
  bank.castShadow = bank.receiveShadow = true;
  group.add(bank);
  return group;
}
