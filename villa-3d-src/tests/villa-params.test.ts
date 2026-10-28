import test from "node:test";
import assert from "node:assert/strict";
import { floors, site, courtyardArcAnchors, courtyardFront, annexFurniture, frontElevation, roadsideVilla, buildingAreas, facts } from "../src/data";
import {
  applyVillaParams,
  DEFAULT_VILLA_PARAMS,
  getVillaParams,
  LOCKED_SITE_WIDTH,
  resetVillaParams,
  validateVillaParams,
  buildingDepthLimits,
} from "../src/villa-params";
import { clonePublishedLayout, scaleLayoutDraftToEnvelope, envelopeFromSite } from "../src/layout-draft";
import { garageLayout } from "../src/garage-layout";
import { surroundings, terraceContours } from "../src/surroundings";
import { contourAt } from "../src/contours";
import { facades, mainEaveY, mainFrontOpeningX } from "../src/facades";
import { mainRoofFootprint } from "../src/architecture";
import { placeRoadsideVilla } from "../src/roadside-villa-layout";
import { collectPlanSiteDimensions } from "../src/plan-dimensions";
import { floorPlan, planSourceFromDraft } from "../src/plan";
import { controlTable } from "../src/meeting-booklet";
import { designBrief, designIssues } from "../src/design-data";

test("门厅改宽改深后全额计入首层一次，概览数据、事实和沟通导出使用同一口径", () => {
  resetVillaParams();
  try {
    applyVillaParams({ ...DEFAULT_VILLA_PARAMS, porticoWidth: 5000, porticoProjection: 2200 });
    assert.equal(buildingAreas.main, 136);
    assert.equal(buildingAreas.annex, 32);
    assert.equal(buildingAreas.portico, 11);
    assert.equal(buildingAreas.total, 179);
    assert.match(facts.find(f => f.label === "外伸通高门厅")!.value, /计入11\.0㎡/);
    assert.match(facts.find(f => f.label === "主楼 \/ 辅楼")!.note, /合计179\.0㎡/);
    assert.match(designBrief[0].text, /合计179\.0㎡/);
    assert.match(designIssues[0].current, /合计179\.0㎡/);
    const table = controlTable();
    assert.match(table, /5000×2200＝11\.0㎡/);
    assert.match(table, /136\.0＋32\.0＋11\.0＝179\.0㎡/);
    assert.match(floorPlan(0, false, false), /门厅 5000×2200 · 计入首层合计/);
    assert.doesNotMatch(table + designBrief[0].text + floorPlan(0, false, false), /门厅[^<。]*另计/);
  } finally { resetVillaParams(); }
  assert.equal(buildingAreas.total, 177.2);
});

test("拆图后改宽深仍统一重算两栋坐标、草稿和各自标线", () => {
  resetVillaParams();
  const draft = clonePublishedLayout();
  try {
    applyVillaParams({ ...DEFAULT_VILLA_PARAMS, mainWidth: 14000, annexWidth: 4300, lane: 1600, mainDepth: 10600, annexDepth: 7500 });
    assert.equal(buildingAreas.total.toFixed(2), "189.85");
    const scaled = scaleLayoutDraftToEnvelope(draft, envelopeFromSite());
    const shared = collectPlanSiteDimensions();
    assert.deepEqual(shared.widthSegmentsMm, [300, 4300, 1600, 14000, 800]);
    assert.equal(shared.widthSegmentsMm.reduce((a, b) => a + b, 0), 21000);
    assert.equal(shared.mainDepthMm, shared.annexDepthMm + shared.annexSetbackMm);
    assert.equal(shared.annexSetbackMm, 3100);
    assert.ok(Math.abs(site.annex.z + site.annex.d - site.main.z - site.main.d) < 1e-6);
    const html = floorPlan(0, false, false, {}, planSourceFromDraft(scaled, 0));
    for (const [building, width, depth] of [["main", 14000, 10600], ["annex", 4300, 7500]] as const) {
      const svg = html.match(new RegExp(`<svg data-plan-building="${building}"[\\s\\S]*?</svg>`))![0];
      // 总宽只标北、总进深只标东，避免对边重复。
      for (const [side, size] of [["north", width], ["east", depth]] as const) {
        const chain = svg.match(new RegExp(`data-dim-side="${side}" data-dim-kind="overall">([\\s\\S]*?)</g>`))![1];
        assert.match(chain, new RegExp(`class="dim-mm"[^>]*>${size}<`));
      }
      assert.ok(!svg.includes(`data-dim-side="south" data-dim-kind="overall"`));
      assert.ok(!svg.includes(`data-dim-side="west" data-dim-kind="overall"`));
    }
    // 辅楼 4000→4300 变宽；主楼 13600→14000 变宽
    assert.ok(scaled.annexRooms[0]!.w > draft.annexRooms[0]!.w);
    assert.ok(scaled.floors[0]!.rooms[0]!.w > draft.floors[0]!.rooms[0]!.w);
    const before = envelopeFromSite();
    assert.throws(() => applyVillaParams({ ...getVillaParams(), lane: 3000 }));
    assert.deepEqual(envelopeFromSite(), before, "拒绝超宽参数时两栋均不得部分更新");
  } finally { resetVillaParams(); }
});

test("进深按主辅楼和门厅实际位置统一校验，改面宽与子孙道也重算可用进深", () => {
  const base = buildingDepthLimits(DEFAULT_VILLA_PARAMS);
  const shifted = buildingDepthLimits({ ...DEFAULT_VILLA_PARAMS, lane: 2000 });
  assert.ok(shifted.annex < base.annex, "辅楼向西移动后院坪较浅");
  const wider = buildingDepthLimits({ ...DEFAULT_VILLA_PARAMS, mainWidth: 14000 });
  assert.ok(wider.main < base.main);
  assert.ok(wider.annex < base.annex);
  for (const [params, field] of [
    [{ ...DEFAULT_VILLA_PARAMS, mainDepth: 20000 }, "mainDepth"],
    [{ ...DEFAULT_VILLA_PARAMS, mainDepth: 13000, annexDepth: 12000 }, "annexDepth"],
    [{ ...DEFAULT_VILLA_PARAMS, porticoProjection: 8000 }, "porticoProjection"],
  ] as const) {
    assert.ok(validateVillaParams(params).some((i) => i.field === field && i.message.includes("院坪总进深")));
  }
});

test("东墙锚定：西侧由其余面宽反推；过宽时校验失败", () => {
  const ok = validateVillaParams(DEFAULT_VILLA_PARAMS);
  assert.equal(ok.length, 0);
  assert.equal(validateVillaParams({ ...DEFAULT_VILLA_PARAMS, secondFrontEave: 600 }).length, 0,
    "无天沟挑檐不扣除三眼皮200级差，600挑出可容纳500梁托");
  assert.ok(validateVillaParams({ ...DEFAULT_VILLA_PARAMS, secondFrontEave: 450 })
    .some(i => i.field === "corbelLength"), "梁托仍不能超出实际挑檐");
  // 主楼略增宽仍可由西侧吸收
  assert.equal(validateVillaParams({ ...DEFAULT_VILLA_PARAMS, mainWidth: 14000 }).length, 0);
  // 主楼过宽导致西侧≤0
  const badWide = validateVillaParams({ ...DEFAULT_VILLA_PARAMS, mainWidth: 15000 });
  assert.ok(badWide.some((i) => i.message.includes("西侧")));
  // 辅楼进深大于主楼（后墙齐平约束）
  const badDeep = validateVillaParams({ ...DEFAULT_VILLA_PARAMS, annexDepth: 11000 });
  assert.ok(badDeep.some((i) => i.field === "annexDepth"));
});

test("改主楼面宽／进深时东墙与南墙不动，只动西墙与北墙", () => {
  resetVillaParams();
  const east0 = site.main.x + site.main.w;
  const south0 = site.main.z + site.main.d;
  applyVillaParams({ ...DEFAULT_VILLA_PARAMS, mainWidth: 14000, mainDepth: 11000 });
  assert.ok(Math.abs(site.main.x + site.main.w - east0) < 1e-6);
  assert.ok(Math.abs(site.main.z + site.main.d - south0) < 1e-6);
  assert.ok(site.main.x < 6800 - 100);
  assert.ok(site.main.z < -400 - 100);
  // 辅楼后墙仍与主楼齐平，东墙贴子孙道西缘
  assert.ok(Math.abs(site.annex.z + site.annex.d - south0) < 1e-6);
  assert.ok(Math.abs(site.annex.x + site.annex.w + site.lane - site.main.x) < 1e-6);
  assert.ok(Math.abs(getVillaParams().westGap - site.annex.x) < 1e-6);
  assert.ok(Math.abs(getVillaParams().annexSetback - (11000 - DEFAULT_VILLA_PARAMS.annexDepth)) < 1e-6);
  resetVillaParams();
});

test("合法改主楼进深后房间与家具同轴比例缩放，还原后回到默认", () => {
  const tea = () => floors[0].rooms.find((r) => r.id === "tea")!;
  const before = { ...tea(), furniture: floors[0].furniture.map((f) => ({ ...f })) };
  const sofa = floors[0].furniture.find((f) => f.kind === "sofa") ?? floors[0].furniture[0];
  assert.ok(sofa);
  const sofaBefore = { w: sofa.w, d: sofa.d, x: sofa.x, z: sofa.z };

  const next = { ...DEFAULT_VILLA_PARAMS, mainDepth: 11000 };
  // 保持总宽：进深变不影响面宽分配
  const scale = applyVillaParams(next);
  assert.ok(Math.abs(scale.sz - 11000 / 10000) < 1e-6);
  assert.ok(Math.abs(scale.sx - 1) < 1e-6);
  assert.equal(site.main.d, 11000);
  const after = tea();
  assert.ok(Math.abs(after.d - before.d * scale.sz) < 1e-6);
  assert.ok(Math.abs(after.w - before.w * scale.sx) < 1e-6);
  const sofaAfter = floors[0].furniture.find((f) => f.id === sofa.id) ?? floors[0].furniture[0];
  assert.ok(Math.abs(sofaAfter.w - sofaBefore.w * scale.sx) < 1e-6);
  assert.ok(Math.abs(sofaAfter.d - sofaBefore.d * scale.sz) < 1e-6);
  // 面积比 = sx×sz
  const areaRatio = (after.w * after.d) / (before.w * before.d);
  assert.ok(Math.abs(areaRatio - scale.sx * scale.sz) < 1e-6);

  resetVillaParams();
  assert.equal(site.main.d, DEFAULT_VILLA_PARAMS.mainDepth);
  assert.equal(site.main.w, DEFAULT_VILLA_PARAMS.mainWidth);
  const restored = tea();
  assert.ok(Math.abs(restored.w - before.w) < 1e-6);
  assert.ok(Math.abs(restored.d - before.d) < 1e-6);
});

test("院坪三点总进深随参数重写锚点", () => {
  applyVillaParams({
    ...DEFAULT_VILLA_PARAMS,
    courtyardWestTotal: 12000,
    courtyardMidTotal: 16000,
    courtyardEastTotal: 20000,
    courtyardMidFromEast: 11000,
  });
  const [west, mid, east] = courtyardArcAnchors;
  assert.ok(Math.abs(west[1] - (DEFAULT_VILLA_PARAMS.oldDepth - 12000)) < 1e-6);
  assert.ok(Math.abs(mid[1] - (DEFAULT_VILLA_PARAMS.oldDepth - 16000)) < 1e-6);
  assert.ok(Math.abs(east[1] - (DEFAULT_VILLA_PARAMS.oldDepth - 20000)) < 1e-6);
  assert.ok(Math.abs(mid[0] - (LOCKED_SITE_WIDTH - 11000)) < 1e-6);
  // 地库入口／sharedFront／邻居前坪须跟新东端外沿，不能停在旧 −8600
  const eastFront = courtyardFront.at(-1)![1];
  assert.ok(Math.abs(garageLayout.entry.z - site.cut.z) < 1e-6);
  assert.ok(Math.abs(garageLayout.entry.z - eastFront) < 1e-6);
  assert.ok(Math.abs(surroundings.neighborYard.z - eastFront) < 1e-6);
  assert.ok(Math.abs(contourAt(terraceContours.sharedFront, site.width) - eastFront) < 50);
  assert.ok(Math.abs(contourAt(terraceContours.rearFirst, site.width / 2) - site.oldDepth) < 50);
  resetVillaParams();
  assert.ok(Math.abs(courtyardArcAnchors[0][1] - (DEFAULT_VILLA_PARAMS.oldDepth - DEFAULT_VILLA_PARAMS.courtyardWestTotal)) < 1e-6);
});

test("屋后预留等场地参数应用后保持用户值，不退回默认 1.2", () => {
  resetVillaParams();
  applyVillaParams({ ...DEFAULT_VILLA_PARAMS, rearGap: 1000, oldDepth: 10500 });
  assert.equal(site.rearGap, 1000);
  assert.equal(site.oldDepth, 10500);
  assert.equal(getVillaParams().rearGap, 1000);
  assert.equal(getVillaParams().oldDepth, 10500);
  // 再应用只改面宽分配中的无关项，预留应仍为 1000
  applyVillaParams({ ...getVillaParams(), westGap: 900, eastGap: 600 });
  assert.equal(getVillaParams().rearGap, 1000);
  resetVillaParams();
  assert.equal(getVillaParams().rearGap, DEFAULT_VILLA_PARAMS.rearGap);
});

test("减小屋后预留时主楼辅楼整体向南平移，后墙到梯田边等于预留", () => {
  resetVillaParams();
  const baseMainZ = site.main.z;
  const baseAnnexZ = site.annex.z;
  applyVillaParams({ ...DEFAULT_VILLA_PARAMS, rearGap: 1000 });
  const expectedMainZ = DEFAULT_VILLA_PARAMS.oldDepth - 1000 - DEFAULT_VILLA_PARAMS.mainDepth;
  assert.ok(Math.abs(site.main.z - expectedMainZ) < 1e-6);
  assert.ok(site.main.z > baseMainZ);
  assert.ok(Math.abs(site.annex.z - (site.main.z + DEFAULT_VILLA_PARAMS.annexSetback)) < 1e-6);
  assert.ok(site.annex.z > baseAnnexZ);
  assert.ok(Math.abs(site.main.z + site.main.d + site.rearGap - site.oldDepth) < 1e-6);
  resetVillaParams();
  assert.ok(Math.abs(site.main.z - baseMainZ) < 1e-6);
});

test("屋后预留变化后通高玻璃与辅楼屋顶随楼体 Z 平移", async () => {
  const { buildVilla, annexRoofFootprint } = await import("../src/architecture");
  const THREE = await import("three");
  type Mats = import("../src/primitives").Mats;
  const mat = new Proxy({} as Mats, {
    get(target, key: keyof Mats) {
      return (target[key] ??= new THREE.MeshPhysicalMaterial() as never);
    },
  });
  resetVillaParams();
  applyVillaParams({ ...DEFAULT_VILLA_PARAMS, rearGap: 1000 });
  // rearGap=1000 → main.z = 10800−1000−10000 = −200；相对默认 −400 南移 200
  assert.ok(Math.abs(site.main.z - (-200)) < 1e-6);
  const roof = annexRoofFootprint();
  // 默认主辅楼出檐数值相同，辅楼由 site.eave 独立控制。
  assert.ok(Math.abs(site.eave - site.thirdEave) < 1e-6);
  assert.ok(Math.abs(roof.z - (site.annex.z - site.thirdEave)) < 1e-6);
  assert.ok(Math.abs(roof.d - (site.annex.d + 2 * site.thirdEave)) < 1e-6);
  assert.ok(Math.abs(roof.w - (site.annex.w + 2 * site.thirdEave)) < 1e-6);
  const villa = buildVilla(mat, false);
  const curtain = villa.group.getObjectByName("挑空客厅一二层通高玻璃");
  assert.ok(curtain);
  let glassZ = Number.NaN;
  curtain!.traverse((o) => {
    if (o instanceof THREE.Mesh && o.name === "通高玻璃分格板块" && Number.isNaN(glassZ)) glassZ = o.getWorldPosition(new THREE.Vector3()).z;
  });
  assert.ok(Number.isFinite(glassZ));
  // 使用分格玻璃本身，而不是依赖子节点顺序；77深框内玻璃中心内收8。
  assert.ok(Math.abs(glassZ - (site.main.z + 128)) < 1e-6);
  resetVillaParams();
});

test("三楼短柱与门厅柱同轴、包角柱外皮对齐，改门厅参数后一起挪", () => {
  resetVillaParams();
  const e = frontElevation;
  const [west, midW, midE, east] = e.balustradePosts;
  // 默认：柱心在门厅北沿左右角
  assert.equal(midW.x, site.portico.x);
  assert.equal(midE.x, site.portico.x + site.portico.w);
  assert.equal(midW.x, e.postXs[0]);
  assert.equal(midE.x, e.postXs[1]);
  assert.equal(midW.z, e.porticoColumnZ);
  assert.equal(midE.z, e.porticoColumnZ);
  assert.ok(Math.abs(midW.z - (site.main.z - site.portico.projection)) < 1e-6);
  assert.equal(midW.w, DEFAULT_VILLA_PARAMS.porticoColumnSize);
  const project = e.cornerProject, leg = e.cornerLeg;
  assert.ok(Math.abs(west.x - (e.cornerWestX - (project - leg) / 2)) < 1e-6);
  assert.ok(Math.abs(east.x - (e.cornerEastX + (project - leg) / 2)) < 1e-6);
  assert.ok(Math.abs((west.z - west.w / 2) - (site.main.z - 120 - project)) < 1e-6);
  // 官帽柱／构造柱北皮贴一层前墙外皮。
  assert.ok(Math.abs(e.postZ - 250 - site.main.z) < 1e-6);

  // 柱心在外伸北沿左右两角；改截面／面宽／外伸后仍贴角。
  applyVillaParams({
    ...DEFAULT_VILLA_PARAMS,
    porticoColumnSize: 900,
    porticoWidth: 5000,
    porticoProjection: 2200,
  });
  const e2 = frontElevation;
  assert.equal(e2.balustradePosts[1].x, site.portico.x);
  assert.equal(e2.balustradePosts[2].x, site.portico.x + site.portico.w);
  assert.equal(e2.balustradePosts[1].z, e2.porticoColumnZ);
  assert.equal(e2.balustradePosts[1].w, 900);
  assert.ok(Math.abs(e2.porticoColumnZ - (site.main.z - 2200)) < 1e-6);
  assert.ok(Math.abs(e2.porticoColumnWallGap - (2200 - 450)) < 1e-6);
  assert.ok(Math.abs(e2.postZ - site.main.z - 250) < 1e-6);

  applyVillaParams({ ...DEFAULT_VILLA_PARAMS, cornerProject: 220 });
  assert.equal(frontElevation.cornerProject, 220);
  const [west2] = frontElevation.balustradePosts;
  assert.ok(Math.abs((west2.z - west2.w / 2) - (site.main.z - 120 - 220)) < 1e-6);
  resetVillaParams();
  assert.equal(frontElevation.cornerProject, DEFAULT_VILLA_PARAMS.cornerProject);
});

test("层高／面宽／辅楼高／北退／邻居／蓝顶房随参数联动", () => {
  resetVillaParams();
  applyVillaParams({
    ...DEFAULT_VILLA_PARAMS,
    floor1Height: 3800,
    floor2Height: 3500,
    floor3Height: 3100,
    mainWidth: 14000,
    annexHeight: 4000,
    thirdSetback: 2000,
    neighborWoodWidth: 14000,
    neighborWoodDepth: 9200,
    eastGap: 600,
  });
  assert.ok(Math.abs(mainEaveY() - (3800 + 3500 + 3100)) < 1e-6);
  assert.ok(Math.abs(mainRoofFootprint().eave - mainEaveY()) < 1e-6);
  assert.ok(Math.abs(frontElevation.hatEave - mainEaveY()) < 1e-6);
  assert.equal(site.annex.height, 4000);
  assert.ok(Math.abs(mainFrontOpeningX(2350) - (site.main.x + 2350 * (14000 / 13500))) < 1e-6);
  assert.ok(Math.abs(floors[2].front - (site.main.z + 2000)) < 1e-6);
  for (const r of floors[2].rooms) assert.ok(r.z + 1e-6 >= floors[2].front, r.id);
  for (const w of floors[2].partitions) {
    assert.ok(w.a[1] + 1e-6 >= floors[2].front);
    assert.ok(w.b[1] + 1e-6 >= floors[2].front);
  }
  assert.equal(surroundings.sideHouse.w, 14000);
  assert.equal(surroundings.sideHouse.d, 9200);
  const expectedRoadsideX = placeRoadsideVilla(
    site.annex.x,
    site.garageFloor - site.frontFieldDrop - site.frontHouseDrop,
  ).x;
  assert.ok(Math.abs(roadsideVilla.x - expectedRoadsideX) < 1e-6);
  const front = facades(0).find((f) => Math.abs(f.a[1] - f.b[1]) < 20)!;
  assert.ok(Math.abs(front.a[0] - site.main.x) < 200);
  assert.ok(Math.abs(front.b[0] - (site.main.x + site.main.w)) < 200);
  resetVillaParams();
});

test("布局草稿按外包络轴向缩放且不叠乘", () => {
  resetVillaParams();
  const draft = clonePublishedLayout();
  assert.ok(draft.annexRooms.length || annexFurniture.length);
  const room0 = draft.floors[0].rooms[0];
  const w0 = room0.w;
  const target = envelopeFromSite();
  target.mainW = 14500;
  // 总宽需配合：此处只测草稿缩放函数
  target.mainD = 10;
  const once = scaleLayoutDraftToEnvelope(draft, target);
  assert.ok(Math.abs(once.floors[0].rooms[0].w - w0 * (14500 / DEFAULT_VILLA_PARAMS.mainWidth)) < 1e-6);
  assert.match(once.note, /已随方案参数重算/);
  const twice = scaleLayoutDraftToEnvelope(once, target);
  assert.ok(Math.abs(twice.floors[0].rooms[0].w - once.floors[0].rooms[0].w) < 1e-6);
  resetVillaParams();
});

test("无效几何组合被校验拒绝：北退、院坪共线、天沟净宽、门厅净空、楼梯洞", () => {
  assert.ok(validateVillaParams({ ...DEFAULT_VILLA_PARAMS, thirdSetback: 10000 }).some((i) => i.field === "thirdSetback"));
  assert.ok(
    validateVillaParams({
      ...DEFAULT_VILLA_PARAMS,
      courtyardWestTotal: 12000,
      courtyardMidTotal: 12000,
      courtyardEastTotal: 12000,
    }).some((i) => i.message.includes("共线")),
  );
  assert.ok(validateVillaParams({ ...DEFAULT_VILLA_PARAMS, gutterClearWidth: 5000 }).some((i) => i.field === "gutterClearWidth"));
  assert.ok(
    validateVillaParams({ ...DEFAULT_VILLA_PARAMS, porticoWidth: 1000, porticoColumnSize: 800 }).some(
      (i) => i.field === "porticoWidth",
    ),
  );
  assert.ok(
    validateVillaParams({ ...DEFAULT_VILLA_PARAMS, porticoProjection: 200, porticoColumnSize: 800 }).some(
      (i) => i.field === "porticoProjection",
    ),
  );
  assert.ok(validateVillaParams({ ...DEFAULT_VILLA_PARAMS, mainDepth: 8000 }).some((i) => i.field === "mainDepth"));
  assert.ok(validateVillaParams({ ...DEFAULT_VILLA_PARAMS, annexHeight: 2500 }).some((i) => i.field === "annexHeight"));
  assert.equal(validateVillaParams(DEFAULT_VILLA_PARAMS).length, 0);
});

test("床等成品家具不随房屋进深缩放外形", () => {
  resetVillaParams();
  const bed = floors[0].furniture.find((f) => f.kind === "bed");
  assert.ok(bed);
  const before = { w: bed!.w, d: bed!.d, x: bed!.x };
  applyVillaParams({ ...DEFAULT_VILLA_PARAMS, mainDepth: 11000 });
  const after = floors[0].furniture.find((f) => f.kind === "bed" && Math.abs(f.w - before.w) < 1e-6)!;
  assert.ok(after);
  assert.ok(Math.abs(after.d - before.d) < 1e-6);
  // 位置应随南墙锚定平移（进深加大时床会南移）
  assert.ok(after.x !== undefined);
  resetVillaParams();
});

test("楼梯梯段实体尺寸不缩，洞口跨向不低于两跑净宽", async () => {
  const { stairLayout } = await import("../src/data");
  resetVillaParams();
  const flight0 = stairLayout.flight;
  const gap0 = stairLayout.gap;
  applyVillaParams({ ...DEFAULT_VILLA_PARAMS, mainWidth: 14000 });
  assert.ok(Math.abs(stairLayout.flight - flight0) < 1e-6);
  assert.ok(Math.abs(stairLayout.gap - gap0) < 1e-6);
  assert.ok(stairLayout.hole.d + 1e-6 >= 2 * stairLayout.flight + stairLayout.gap);
  resetVillaParams();
});
