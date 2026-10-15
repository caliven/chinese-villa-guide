import test from "node:test";
import assert from "node:assert/strict";
import { carCorners, contains, polygonArea, site } from "../src/data";
import { garageLayout, rectangle } from "../src/garage-layout";
import { basementColumns, roadHeight, surroundings } from "../src/surroundings";
import {
  assessVehicleRoute, footprintWithin, inspectFootprint, polygonsOverlap,
  routeHeight, routePose, routeRanges, vehicleRoute,
} from "../src/vehicle-route";

const assessment = assessVehicleRoute(surroundings.road.entryY, 5);

test("扫掠保留原路线端点、L9尺寸与偏航方向，弯道包络包含整车前后悬", () => {
  const first = assessment.poses[0], last = assessment.poses.at(-1)!;
  assert.equal(first.x, surroundings.road.x + surroundings.road.w / 2);
  assert.equal(first.z, -18);
  assert.ok(Math.abs(last.x - 18.5) < 1e-8);
  assert.ok(Math.abs(last.z + 2.8) < 1e-8);
  const footprint = carCorners(0, 0, 0);
  assert.equal(Math.max(...footprint.map((p) => p[0])) * 2, site.vehicle.width);
  assert.equal(Math.max(...footprint.map((p) => p[1])) * 2, site.vehicle.length);
  assert.equal(assessment.cells.length, assessment.poses.length - 1);
  for (const [i, cell] of assessment.cells.entries()) {
    for (const p of [...assessment.poses[i].corners, ...assessment.poses[i + 1].corners])
      assert.ok(contains(p, cell.footprint), `整车占位在扫掠外 @ ${i}`);
    assert.ok(polygonArea(cell.footprint) >= site.vehicle.width * site.vehicle.length - 1e-6);
    const a = assessment.poses[i], b = assessment.poses[i + 1];
    const yawDelta = Math.abs(Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw)));
    assert.ok(yawDelta <= Math.PI / 90 + 1e-6);
  }
  const pose = routePose(0.7, surroundings.road.entryY, 5);
  const tangent = vehicleRoute.getTangentAt(0.7);
  assert.ok(Math.abs(-Math.sin(pose.yaw) - tangent.x) < 1e-6);
  assert.ok(Math.abs(-Math.cos(pose.yaw) - tangent.z) < 1e-6);
});

test("柱完全落在车身内、细墙交叉与贴边均能发现，分离物体不误报", () => {
  const car = rectangle(-1, -2.6, 2, 5.2);
  const insideColumn = rectangle(-0.18, -0.18, 0.36, 0.36);
  assert.ok(car.every((p) => !contains(p, insideColumn)));
  assert.ok(polygonsOverlap(car, insideColumn));
  const crossWall = rectangle(-4, -0.1, 8, 0.2);
  assert.ok(car.every((p) => !contains(p, crossWall)));
  assert.ok(crossWall.every((p) => !contains(p, car)));
  assert.ok(polygonsOverlap(car, crossWall));
  assert.ok(polygonsOverlap(car, rectangle(1, -1, 0.2, 2)));
  assert.equal(polygonsOverlap(car, rectangle(1.01, -1, 0.2, 2)), false);
});

test("通道检查识别四角都在范围内但车身横跨凹口，同时允许相接通道并集", () => {
  const concave: [number, number][] = [
    [0, 0], [5, 0], [5, 5], [3, 5], [3, 2], [2, 2], [2, 5], [0, 5],
  ];
  const car = rectangle(1, 1, 3, 3);
  assert.ok(car.every((p) => contains(p, concave)));
  assert.equal(footprintWithin(car, [concave]), false);
  assert.ok(footprintWithin(rectangle(0.5, 0.5, 2, 1), [rectangle(0, 0, 1.5, 2), rectangle(1.5, 0, 1.5, 2)]));
});

test("全程筛查覆盖保留地坪与实际模型柱，未确认的拟切口不消除净高待测状态", () => {
  assert.equal(garageLayout.retainedDeck.soffitY, null);
  assert.equal(garageLayout.proposedCut.confirmed, false);
  assert.ok(assessment.underDeck);
  assert.ok(assessment.conflicts.some((o) => o.id === "column-5-inner"));
  const cut = garageLayout.proposedCut.footprint;
  const whollyInCut = rectangle(cut[0][0] + 0.1, cut[0][1] + 0.1, 1, 1);
  assert.ok(footprintWithin(whollyInCut, [cut]));
  assert.ok(inspectFootprint(whollyInCut).underDeck, "待协商切口不能直接算露天区");
  const ranges = routeRanges(assessment.cells, (c) => c.underDeck);
  assert.ok(ranges[0][0] > 0 && ranges[0][0] < 0.5);
  assert.ok(ranges.at(-1)![1] > 0.8 && ranges.at(-1)![1] < 1);
  const outside = routeRanges(assessment.cells, (c) => c.outside);
  assert.equal(outside.length, 2, "分开的越界段不能合成一条连续风险段");
});

test("柱墙筛查共用实体尺寸，包括墙内包含车身的潜在投影相交", () => {
  const base = basementColumns();
  for (const [i, column] of base.columns.entries()) {
    for (const [j, row] of (["outer", "inner"] as const).entries()) {
      const model = garageLayout.columns[i * 2 + j];
      assert.ok(contains(column[row], model.footprint));
      assert.ok(Math.abs(polygonArea(model.footprint) - 0.36 ** 2) < 1e-7);
    }
  }
  const wall = garageLayout.wallSegments.at(-1)!;
  const center = wall.footprint.reduce((sum, p) => [sum[0] + p[0] / 4, sum[1] + p[1] / 4], [0, 0]);
  const probe = carCorners(center[0], center[1], Math.PI / 2);
  assert.ok(inspectFootprint(probe).obstacles.includes(wall), "外沿矮墙必须参与潜在冲突筛查");
});

test("改示意道路标高与坡长只改变高度，路线与净高未知状态保持一致", () => {
  const z = -7.35, length = 5, roadY = -2;
  const surface = roadHeight(z) + roadY - surroundings.road.entryY;
  assert.equal(routeHeight(site.width, z, roadY, length), site.garageFloor);
  assert.ok(Math.abs(routeHeight(site.width + length / 2, z, roadY, length)
    - (site.garageFloor + surface) / 2) < 1e-8);
  const a = routePose(0, roadY, length), b = routePose(0, roadY + 0.6, 9);
  assert.equal(a.x, b.x);
  assert.equal(a.z, b.z);
  assert.equal(a.yaw, b.yaw);
  assert.ok(Math.abs(b.y - a.y - 0.6) < 1e-8);
  assert.equal(routePose(1, roadY + 0.6, 9).y, site.garageFloor);
  assert.equal(garageLayout.retainedDeck.soffitY, null);
});
