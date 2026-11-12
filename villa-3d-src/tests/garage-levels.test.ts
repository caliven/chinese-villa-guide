import test from "node:test";
import assert from "node:assert/strict";
import { courtyardFront, garageLevelValues, site } from "../src/data.ts";
import { contourAt } from "../src/contours.ts";
import {
  basementFloorY,
  beamDepthAt,
  beamSoffitAt,
  garageLayout,
  neighborYardWestX,
  outerLaneDepth,
  rebuildGarageLayout,
} from "../src/garage-layout.ts";
import {
  annexColumnInnerZ,
  basementColumns,
  mainFrontGaragePocket,
  mainFrontOverhangDepth,
  mainFrontPadHole,
  surroundings,
} from "../src/surroundings.ts";
import {
  applyVillaParams,
  DEFAULT_VILLA_PARAMS,
  resetVillaParams,
  validateVillaParams,
} from "../src/villa-params.ts";

test("主楼仅外伸架空：台地不开洞、屋内不下挖", () => {
  resetVillaParams();
  const overhang = mainFrontOverhangDepth();
  assert.equal(overhang, Math.max(0, -site.main.z));
  assert.ok(overhang > 0, "默认前墙应相对台地南缘外伸");
  assert.deepEqual(mainFrontPadHole(), [], "实体台地铺装／石基不得开洞");
  const pocket = mainFrontGaragePocket();
  assert.equal(pocket.length, 4);
  assert.deepEqual(pocket[0], [site.main.x, site.main.z]);
  assert.deepEqual(pocket[1], [site.main.x + site.main.w, site.main.z]);
  assert.deepEqual(pocket[2], [site.main.x + site.main.w, 0]);
  assert.deepEqual(pocket[3], [site.main.x, 0]);
  assert.ok(pocket.every(([, z]) => z <= 0), "开洞不得伸入 Z>0 实体台地");
});

test("默认两家地库完成面由净高和梁底推出，邻居更高", () => {
  const levels = garageLevelValues(DEFAULT_VILLA_PARAMS);
  assert.equal(levels.ownBeam, -450);
  assert.equal(levels.ownFloor, -2950);
  assert.equal(levels.neighborBeam, -450);
  assert.equal(levels.neighborFloor, -2250);
  assert.equal(levels.neighborSlab, -150);
  assert.equal(levels.neighborSlabClear, 2100);
  assert.ok(levels.neighborFloor > levels.ownFloor);
  assert.equal(site.garageFloor, levels.ownFloor);
  assert.equal(site.neighborGarageFloor, levels.neighborFloor);
  assert.equal(site.neighborBeamReach, 2200);
  assert.equal(site.neighborColumnEdgeInset, 1200);
});

test("邻居地库独立2×2柱网，自家柱不跨入邻居院坪", () => {
  rebuildGarageLayout();
  const cols = basementColumns();
  const yard = surroundings.neighborYard;
  const inset = site.neighborColumnEdgeInset;
  const lane = site.neighborBeamReach;
  assert.equal(cols.neighborColumns.length, 2);
  assert.deepEqual(
    cols.neighborColumns.map((column) => column.x),
    [Math.round(yard.x + inset), Math.round(surroundings.road.x - inset)],
  );
  for (const column of cols.neighborColumns) {
    assert.equal(column.domain, "neighbor");
    assert.ok(Math.abs(column.outer[1] - (yard.z + lane)) < 1, "外侧柱距最外沿");
    assert.ok(Math.abs(column.inner[1] - (surroundings.sideHouse.z - inset)) < 1, "房前柱距院坪北缘");
  }
  assert.ok(cols.ownColumns.every((column) => column.x < yard.x));
  assert.ok(cols.ownColumns.every((column) => column.domain === "own"));
  assert.ok(garageLayout.partitionWall, "内区应有分隔墙");
  const part = garageLayout.partitionWall!;
  const eastColumn = cols.ownColumns.at(-1)!;
  const wallX = (part.footprint[0][0] + part.footprint[2][0]) / 2;
  assert.equal(wallX, eastColumn.x, "墙中心线对齐东侧纵梁与柱中心线");
  assert.equal(part.top, beamSoffitAt(wallX), "墙顶贴梁底");
  assert.ok(Math.max(...part.footprint.map(point => point[1])) <= eastColumn.inner[1], "墙体全段处于梁下");
  assert.ok(Math.min(...part.footprint.map((point) => point[1])) >= yard.z + outerLaneDepth() - 1);
});

test("斜坡只在最外层，外墙连续，两家完成面分开", () => {
  const yardWest = neighborYardWestX();
  const lane = outerLaneDepth();
  const interiorZ = surroundings.neighborYard.z + lane + 1500;
  assert.equal(basementFloorY(yardWest + 1000, interiorZ), site.neighborGarageFloor);
  assert.equal(basementFloorY(yardWest - 1000, interiorZ), site.garageFloor);
  const rampZ = surroundings.neighborYard.z + lane / 2;
  const mid = basementFloorY(yardWest - 2500, rampZ);
  assert.ok(mid < site.neighborGarageFloor && mid > site.garageFloor);
  assert.ok(garageLayout.columns.some((column) => column.top > column.bottom));
  const wallXs = garageLayout.wallSegments.flatMap((wall) => wall.footprint.map((point) => point[0]));
  assert.ok(Math.max(...wallXs) <= site.width + 80, "水平矮墙停在自家东界附近");
  assert.ok(garageLayout.transitionWall, "斜坡外侧应有过渡段");
  assert.ok(garageLayout.fullOuterWallPath.length > garageLayout.transitionWall!.path.length, "外墙应连成一整段");
  const full = garageLayout.fullOuterWallPath;
  assert.ok(Math.abs(full.at(-1)![0] - surroundings.neighborYard.x) < 1);
  assert.ok(Math.abs(basementFloorY(yardWest - 2500, surroundings.neighborYard.z + 100) - site.garageFloor) > 100);
});

test("自家东侧边柱贴分界、中间轴居中，主楼承重轴不随邻居退距移动", () => {
  resetVillaParams();
  const before = basementColumns();
  const main = before.ownColumns.filter(column => column.role === "main");
  try {
    for (const size of [400, 600]) {
      applyVillaParams({ ...DEFAULT_VILLA_PARAMS, garageColumnSize: size, neighborColumnEdgeInset: 1600 });
      const columns = basementColumns();
      const edge = columns.ownColumns.at(-1)!;
      assert.equal(edge.x + size / 2, surroundings.neighborYard.x, "边柱外皮贴两家分界线");
      assert.equal(edge.inner[0], edge.outer[0], "前后两根边柱同轴");
      const east = columns.ownColumns.filter(column => column.x >= columns.mainAxes.axisD);
      assert.equal(east.length, 3);
      assert.ok(Math.abs(east[1].x - (east[0].x + east[2].x) / 2) <= 1, "中间柱梁位于东侧跨度中央");
      assert.deepEqual(columns.ownColumns.filter(column => column.role === "main"), main, "主楼下柱位保持锁定");
      assert.equal(columns.neighborColumns[0].x, surroundings.neighborYard.x + 1600, "邻居柱保留独立退距");
      rebuildGarageLayout();
      const wall = garageLayout.partitionWall!;
      assert.equal((wall.footprint[0][0] + wall.footprint[2][0]) / 2, edge.x, "改柱宽后墙仍在梁中央");
      assert.equal(wall.top, beamSoffitAt(edge.x));
    }
  } finally {
    resetVillaParams();
  }
});

test("柱顶贴梁底、梁截面到楼板底，柱梁尺寸跟参数", () => {
  assert.equal(site.garageColumnSize, 400);
  assert.equal(site.garageBeamWidth, 350);
  assert.equal(site.garageSlabThickness, 150);
  assert.equal(garageLayout.columnWidth, 400);
  assert.equal(beamSoffitAt(site.width / 2), -site.deckStructure);
  assert.equal(beamDepthAt(site.width / 2), site.deckStructure - site.garageSlabThickness);
  assert.equal(beamSoffitAt(surroundings.neighborYard.x + 100), -site.neighborBeamDrop);
  assert.ok(beamDepthAt(surroundings.neighborYard.x + 100) >= 80);
  for (const column of garageLayout.columns) {
    const x = (column.footprint[0][0] + column.footprint[2][0]) / 2;
    assert.ok(Math.abs(column.top - beamSoffitAt(x)) < 1, "柱顶应贴梁底");
  }
});

test("主楼承重柱先锁定：前墙四根＋门厅前沿两根，再补两侧", () => {
  const cols = basementColumns();
  const axes = cols.mainAxes;
  const mainCols = cols.ownColumns.filter((column) => column.role === "main");
  assert.equal(mainCols.length, 4, "主楼四根承重轴（A–D）");
  assert.deepEqual(mainCols.map((column) => column.x), [...axes.wallXs]);
  for (const column of mainCols) {
    assert.equal(column.inner[1], site.main.z, "前墙柱贴主楼前墙");
    assert.ok(column.outer[1] < column.inner[1] - 1500, "外沿到前墙纵梁两端落柱");
  }
  const withMid = mainCols.filter((column) => column.mid);
  assert.equal(withMid.length, 2, "凸出式门厅 B／C 轴须有门厅下柱");
  assert.deepEqual(withMid.map((column) => column.x), axes.porticoXs);
  for (const column of withMid) {
    assert.equal(column.mid![1], site.main.z - site.portico.projection);
    assert.ok(column.mid![1] > column.outer[1] + 100);
    assert.ok(column.mid![1] < column.inner[1] - 100);
  }
  // 两侧补柱不得侵入主楼承重轴净距
  for (const column of cols.ownColumns.filter((entry) => entry.role === "side")) {
    for (const mx of axes.wallXs) {
      assert.ok(Math.abs(column.x - mx) >= 2000, `侧柱 ${column.x} 过于靠近承重轴 ${mx}`);
    }
  }
});

test("弧形外沿柱沿弧布、柱净距可过车，外沿柱不穿出板边", () => {
  const cols = basementColumns();
  assert.ok(cols.clearSpan >= 3400, `柱间净宽 ${cols.clearSpan} 应≥3400，小车可过`);
  assert.ok(cols.ownColumns.length >= 5);
  for (const column of cols.ownColumns) {
    if (column.x > site.width) continue;
    const edge = contourAt(courtyardFront, column.x);
    const annexFront = Math.abs(column.inner[1] - annexColumnInnerZ()) < 80;
    const single = column.span < 1;
    if (single) {
      assert.ok(annexFront, "仅辅楼前极浅轴允许单柱");
      assert.equal(column.outer[1], column.inner[1], "单柱外沿与里侧重合");
      assert.ok(column.inner[1] >= edge + 200 - 1e-6, "单柱须在板边内侧");
      continue;
    }
    assert.ok(column.outer[1] >= edge + 200 - 1e-6, "外沿柱应在板边内侧");
    assert.ok(column.span >= (annexFront ? 450 : 2000), "纵梁轴进深足够，两端都有柱");
    assert.ok(column.inner[1] > column.outer[1], "房前柱在外沿柱北侧");
  }
  // 主楼开间约 4400；左右侧跨等分，间距贴近目标约 4200，不得密布。
  const own = cols.ownColumns.filter((column) => column.x <= site.width + 1);
  const annexInner = annexColumnInnerZ();
  assert.equal(annexInner, 0, "辅楼段里侧柱应贴院坪台地南缘 Z=0，不贴前墙");
  for (let i = 1; i < own.length; i++) {
    const gap = own[i].x - own[i - 1].x;
    assert.ok(gap >= 2000, `柱中心距 ${Math.round(gap)} 过小（密）`);
    assert.ok(gap <= 5800, `柱中心距 ${Math.round(gap)} 过大`);
  }
  // 左右侧跨以主楼边柱为端点等分（相对差 ≤15%）。
  const westXs = own.filter((c) => c.x <= cols.mainAxes.axisA).map((c) => c.x);
  const eastXs = own.filter((c) => c.x >= cols.mainAxes.axisD).map((c) => c.x);
  for (const xs of [westXs, eastXs]) {
    if (xs.length < 3) continue;
    const gaps = xs.slice(1).map((x, i) => x - xs[i]);
    const avg = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    for (const g of gaps) {
      assert.ok(Math.abs(g - avg) / avg <= 0.15, `侧跨不等分：${gaps.join("/")} 相对均距 ${Math.round(avg)}`);
    }
  }
  const annexFrontCols = cols.ownColumns.filter((column) => Math.abs(column.inner[1] - annexInner) < 80);
  assert.ok(annexFrontCols.length >= 1, "辅楼前院坪应有侧柱");
  for (const column of annexFrontCols) {
    assert.equal(column.inner[1], 0, "柱心须贴 Z=0，不落在辅楼实体地基下");
    assert.ok(column.inner[1] < site.annex.z - 200, "柱心须在前墙以南");
    if (column.span > 0) {
      assert.ok(column.span >= site.garageColumnSize + 50, "有纵跨时外沿／里侧柱不得投影重叠");
    }
  }
  const mainRow = cols.ownColumns.filter((column) => Math.abs(column.inner[1] - site.main.z) < 1);
  assert.ok(mainRow.length >= 2, "主楼／斜坡段应有地库柱");
  for (const column of mainRow) {
    assert.equal(column.inner[1], site.main.z, "里侧柱须与主楼房前柱水平对齐");
    assert.ok(column.outer[1] < column.inner[1] - 1500, "外沿纵梁里侧末端必须有柱");
  }
});

test("改净高后完成面跟着变，邻居地面不能低于自家", () => {
  resetVillaParams();
  applyVillaParams({ ...DEFAULT_VILLA_PARAMS, garageClear: 2400, neighborBeamClear: 1600 });
  assert.equal(site.garageFloor, -450 - 2400);
  assert.equal(site.neighborGarageFloor, -450 - 1600);
  assert.ok(validateVillaParams({ ...DEFAULT_VILLA_PARAMS, neighborBeamClear: 3000 }).some((issue) => issue.field === "neighborBeamClear"));
  assert.ok(validateVillaParams({ ...DEFAULT_VILLA_PARAMS, neighborBeamReach: 1800 }).some((issue) => issue.field === "neighborBeamReach"));
  assert.ok(validateVillaParams({ ...DEFAULT_VILLA_PARAMS, neighborColumnEdgeInset: 200 }).some((issue) => issue.field === "neighborColumnEdgeInset"));
  resetVillaParams();
});
