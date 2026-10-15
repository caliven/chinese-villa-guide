import * as THREE from "three";
import { site, type Point } from "./data";
import { garageLayout } from "./garage-layout";
import { line, tag } from "./primitives";
import { routeHeight, type RouteAssessment } from "./vehicle-route";

export const routeColors = { sweep: 0x328baa, pending: 0xe9a12b, conflict: 0xe44a49, cut: 0xa274cf };

// 保留地坪是矩形。待核区只裁到投影范围，拟切口没有协商确认，不能从待核区扣除。
function clipToDeck(points: Point[]) {
  const deck = garageLayout.retainedDeck.footprint;
  let polygon = points;
  for (const [axis, edge, sign] of [
    [0, deck[0][0], 1], [0, deck[1][0], -1],
    [1, deck[0][1], 1], [1, deck[2][1], -1],
  ]) {
    const input = polygon;
    polygon = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[i], b = input[(i + 1) % input.length];
      const da = (a[axis] - edge) * sign, db = (b[axis] - edge) * sign;
      if (da >= 0) polygon.push(a);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        polygon.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
  }
  return polygon;
}

function footprintMesh(
  polygons: Point[][], height: (p: Point) => number, color: number,
  opacity: number, order: number, stencilRef = 0,
) {
  const vertices: number[] = [];
  for (const polygon of polygons) {
    const contour = polygon.map(([x, z]) => new THREE.Vector2(x, z));
    for (const triangle of THREE.ShapeUtils.triangulateShape(contour, []))
      for (const i of triangle) vertices.push(polygon[i][0], height(polygon[i]), polygon[i][1]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color, opacity, transparent: true, side: THREE.DoubleSide, forceSinglePass: true,
    depthTest: false, depthWrite: false,
    // 每层同色扫掠只着色一次，避免相邻整车包络重叠后不透明、转弯处发黑。
    stencilWrite: stencilRef > 0, stencilRef,
    stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
  }));
  mesh.renderOrder = order;
  return mesh;
}

function outline(parent: THREE.Group, polygon: Point[], y: number, color: number, dashed = false) {
  const shape = line(parent, [...polygon, polygon[0]].map(([x, z]) => new THREE.Vector3(x, y, z)), color, dashed);
  shape.material.depthTest = false;
  shape.material.depthWrite = false;
  shape.renderOrder = 8;
  return shape;
}

export function buildGarageRouteVisual(assessment: RouteAssessment) {
  const group = new THREE.Group(), sweep = new THREE.Group();
  const clearance = new THREE.Group(), conflicts = new THREE.Group();
  group.name = "地库车辆路线可视化校核";
  sweep.name = "L9车身平面扫掠范围";
  clearance.name = "保留地坪下方净高待核区";
  conflicts.name = "柱墙及示意通道潜在冲突";
  group.add(sweep, clearance, conflicts);
  const y = ([x, z]: Point) => routeHeight(x, z, assessment.roadY, assessment.rampLength) + 0.11;
  sweep.add(footprintMesh(assessment.cells.map((c) => c.footprint), y, routeColors.sweep, 0.32, 2, 1));
  // 定距显示整车矩形，能看见转向时前后悬与车尾的占位，避免把定宽路线带当成扫掠。
  assessment.poses.filter((_, i, all) => i % 22 === 0 || i === all.length - 1).forEach((p) => {
    outline(sweep, p.corners, p.y + 0.13, routeColors.sweep);
  });
  const deck = garageLayout.retainedDeck;
  clearance.add(footprintMesh([deck.footprint], () => deck.modelSlabBottom, routeColors.pending, 0.1, 1));
  outline(clearance, deck.footprint, deck.modelSlabBottom, routeColors.pending, true);
  clearance.add(footprintMesh(assessment.cells.filter((c) => c.underDeck)
    .map((c) => clipToDeck(c.footprint)).filter((p) => p.length >= 3),
  y, routeColors.pending, 0.45, 3, 2));
  const centerX = (deck.footprint[0][0] + deck.footprint[1][0]) / 2;
  tag(clearance, "保留地坪下方 · 净高待测", centerX, 1.1, -2.2, "#895b14", 0.9);
  // 只叠加待协商范围，不隐藏地坪、也不把切口视作露天口。
  const cut = garageLayout.proposedCut.footprint;
  outline(clearance, cut, 0.04, routeColors.cut, true);
  tag(clearance, "拟切口 · 协商待确认", site.cut.x + site.cut.w / 2, 1.2,
    site.cut.z - 0.6, "#8052a3", 0.78);

  const bad = assessment.cells.filter((c) => c.outside || c.obstacles.length);
  conflicts.add(footprintMesh(bad.map((c) => c.footprint), y, routeColors.conflict, 0.4, 4, 3));
  for (const obstacle of assessment.conflicts) {
    const { footprint, top, bottom } = obstacle;
    outline(conflicts, footprint, bottom + 0.04, routeColors.conflict);
    outline(conflicts, footprint, top + 0.04, routeColors.conflict);
    for (const [x, z] of footprint) {
      const vertical = line(conflicts, [new THREE.Vector3(x, bottom, z), new THREE.Vector3(x, top + 0.04, z)], routeColors.conflict);
      vertical.material.depthTest = false;
      vertical.material.depthWrite = false;
      vertical.renderOrder = 8;
    }
    if (obstacle.kind === "column") {
      const x = (footprint[0][0] + footprint[2][0]) / 2;
      const z = (footprint[0][1] + footprint[2][1]) / 2;
      tag(conflicts, `${obstacle.label} · 潜在冲突`, x, top + 0.8, z, "#b02e32", 0.68);
    }
  }
  const current = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(site.vehicle.width, site.vehicle.height, site.vehicle.length)),
    new THREE.LineBasicMaterial({ color: routeColors.sweep, depthTest: false, depthWrite: false }),
  );
  current.name = "当前车身包络 · 不含后视镜与纵坡俯仰";
  current.renderOrder = 9;
  group.add(current);
  return { group, sweep, clearance, conflicts, current };
}
