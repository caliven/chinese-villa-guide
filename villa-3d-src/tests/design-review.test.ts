import test from "node:test";
import assert from "node:assert/strict";
import { floors, site } from "../src/data";
import { bedroomSummary, entranceMetrics, roomReference, southWindowProbes, stairMetrics } from "../src/design-data";
import { designDrawings, unresolvedConditions } from "../src/design-drawings";
import { emptySession, mergeSessions, parseSession, validateMeetingView, viewFlags, type MeetingView } from "../src/design-session";
import { meetingBooklet } from "../src/meeting-booklet";
import { courtyardSitePlan, floorPlan } from "../src/plan";
import { facades } from "../src/facades";
import { DEFAULT_VILLA_PARAMS, resetVillaParams } from "../src/villa-params";

const view = (): MeetingView => ({
  roofStyle: "joined",
  courtyardFinish: "concrete", neighborCourtyardFinish: "concrete",
  tab: "model", camera: "garage", level: 0, planMode: "2d", existing: false, balcony: false,
  fenShui: 4.5, roadY: -1860, rampLength: 5000, progress: 72,
  sunDate: "2026-09-23", sunTime: 10.5, dining: "full",
  flags: Object.fromEntries(viewFlags.map((key) => [key, true])),
  pose: { position: [48, 30, -43], target: [26.5, -1.4, -9.5], zoom: 1 },
  villaParams: { ...DEFAULT_VILLA_PARAMS },
});
test("控制线分别起算，首层抬高反映在楼梯与辅楼连接中", () => {
  const m = entranceMetrics();
  // 柱心在北沿角上：前墙→柱北皮＝外伸＋半柱＝2400；平台／台阶由此派生。
  for (const [key, value] of Object.entries({ column: 2400, platform: 2550, steps: 3150, connectionRise: 435, rampGrade: 22.5 }))
    assert.ok(Math.abs(m[key as keyof typeof m] - value) < 1e-6, key);
  assert.equal(m.projection, 2000);
  const stairs = stairMetrics();
  assert.deepEqual(stairs.map((s) => s.rise), [3150, 3600]);
  assert.deepEqual(stairs.map((s) => s.riser), [3150 / 20, 3600 / 20]);
  assert.ok(stairs.every((s) => s.headroom === null && s.clearWidth === null));
});
test("用途待定不计为已确定卧室；套卫包络不转成可用净面积", () => {
  assert.equal(bedroomSummary(0), "1间卧室＋1间用途待定");
  assert.equal(bedroomSummary(1), "3间卧室");
  assert.equal(bedroomSummary(2), "2间卧室");
  const elder = floors[0].rooms.find((r) => r.id === "elder")!;
  const ref = roomReference(elder, 0);
  assert.ok(ref.w < elder.w && ref.d < elder.d);
  assert.ok(ref.nested.some((r) => r.id === "ensuite"));
  assert.match(ref.note, /不可与子房间面积相加/);
  assert.ok(!("usableArea" in ref));
});
test("院坪总图含自家弧线与邻居口述占位，不画室内隔墙", () => {
  const svg = courtyardSitePlan();
  assert.match(svg, /整体院坪平面图/);
  assert.match(svg, /邻居面宽 13000/);
  assert.match(svg, /门厅中心前墙→外沿/);
  assert.match(svg, /左柱外缘→外沿/);
  assert.match(svg, /右柱外缘→外沿/);
  assert.equal([...svg.matchAll(/[左右]柱外缘→外沿/g)].length, 2);
  assert.ok(!svg.includes("柱心→外沿"));
  assert.ok(!/\b门厅前墙→外沿/.test(svg));
  assert.match(svg, /左开间墙→外沿/);
  assert.match(svg, /右开间墙→外沿/);
  assert.match(svg, /主楼前墙→外沿/);
  assert.match(svg, /主楼右角→外沿/);
  assert.match(svg, /子孙道 1800/);
  assert.ok(!svg.includes(">过道 "));
  assert.ok(!/>子孙道</.test(svg));
  assert.match(svg, /罗马柱门厅/);
  assert.match(svg, /4500×2000/);
  assert.ok(!svg.includes("前院东宽西窄"));
  assert.match(svg, /邻院外 8600/);
  assert.match(svg, /西总进深 11000/);
  assert.match(svg, /东总进深 19400/);
  assert.match(svg, /中总进深 15800/);
  assert.match(svg, /dim-ext/);
  assert.match(svg, /yard-dim-direct/);
  assert.match(svg, /yard-dim-extend/);
  assert.match(svg, /dim-anchor/);
  assert.match(svg, /dim-arrow/);
  assert.match(svg, /data-yard-dim=/);
  assert.match(svg, /data-axis="x"/);
  assert.match(svg, /data-axis="z"/);
  assert.match(svg, /yard-dim-hit/);
  assert.match(svg, /data-edge=/);
  assert.match(svg, /data-base-dim=/);
  // 图内「内退」「中总进深」「主楼前墙→外沿」默认贴边，无虚线；黄点在 edge
  // 辅楼默认进深 8000 → 相对主楼内退 2000
  for (const label of ["内退 2000", "中总进深 15800", "主楼前墙→外沿"]) {
    const at = svg.indexOf(label);
    const open = svg.lastIndexOf("<g class=\"yard-dim", at);
    const g = svg.slice(open, svg.indexOf("</g>", at) + 4);
    assert.match(g, /yard-dim-direct/, label);
    assert.ok(!g.includes("dim-ext"), label);
    assert.match(g, /data-edge=/, label);
  }
  // 偏移只改尺寸线位置，黄点 edge 不变
  const shifted = courtyardSitePlan({ "v-setback": 1500 });
  assert.match(shifted, /data-yard-dim="v-setback"[^>]*data-shift="1500"/);
  {
    const at = shifted.indexOf("内退 2000");
    const open = shifted.lastIndexOf("<g class=\"yard-dim", at);
    const g = shifted.slice(open, shifted.indexOf("</g>", at) + 4);
    assert.match(g, /dim-ext/);
    assert.match(g, /yard-dim-extend/);
    const edge = g.match(/data-edge="([^"]+)"/)?.[1];
    const base = g.match(/data-base-dim="([^"]+)"/)?.[1];
    assert.ok(edge && base);
    assert.equal(edge, base, "direct 标注默认尺寸线贴边");
  }
  assert.ok(!svg.includes("大门／柱间三步"));
  assert.ok(!svg.includes("柱间三步"));
  assert.ok(!svg.includes('fill="#3a2422"'));
  assert.ok(!svg.includes('class="partition"'));
  assert.ok(!svg.includes('data-room='));
});
test("辅楼餐厅圆桌情景切换不影响车辆尺寸", () => {
  // 与并行的 villa-params 测试共享模块状态，先还原默认外包络／家具坐标。
  resetVillaParams();
  const full = floorPlan(0, true, false, { dining: "full" });
  const daily = floorPlan(0, true, false, { dining: "daily" });
  const chairs = (s: string) => [...s.matchAll(/class="furniture chair"/g)].length;
  // 餐厅圆桌6座；daily 情景收起圆桌椅（靠背用 chair-back，不再双计）
  assert.equal(chairs(full) - chairs(daily), 6);
  assert.match(daily, /收纳待定/);
  assert.equal(site.vehicle.length, 5218);
});
test("日照探针由真实南窗洞口生成，采样点留在窗高范围内", () => {
  const probes = southWindowProbes();
  // 一层南向：南侧房＋临时餐厅大窗＋尊亲房；二层南向大窗若干（门洞不计）
  assert.ok(probes.length >= 4);
  for (const [index, floor] of floors.slice(0, 2).entries()) {
    const wall = facades(index).find((w) => Math.abs(w.a[1] - w.b[1]) < 10 && w.a[1] > 8750)!;
    for (const o of wall.openings.filter((o) => o.w > 1500 && !o.door)) {
      const p = probes.find((p) => Math.abs(p.x - wall.a[0] - o.at) < 1e-6 && p.name.startsWith(floor.name))!;
      assert.ok(p);
      assert.ok(p.y - p.sampleOffset >= floor.y + o.sill);
      assert.ok(p.y + p.sampleOffset <= floor.y + o.sill + o.h);
    }
  }
});
test("会议JSON完整回读，不接受非法机位、未知图层值、日期和越界参数", () => {
  const session = emptySession();
  session.notes.D04 = { status: "待补资料", owner: "设计师", due: "2026-11-03", body: "最低梁底待测" };
  session.snapshots.push({ id: "test-view", title: "入口A", createdAt: "2026-10-15T00:00:00Z", revision: session.revision, view: view() });
  assert.deepEqual(parseSession(JSON.stringify(session)), session);
  assert.throws(() => validateMeetingView({ ...view(), roadY: NaN }));
  assert.throws(() => validateMeetingView({ ...view(), rampLength: 0 }));
  assert.throws(() => validateMeetingView({ ...view(), sunDate: "2026-02-30" }));
  assert.throws(() => validateMeetingView({ ...view(), pose: { position: [1, 1, 1], target: [1, 1, 1], zoom: 1 } }));
  assert.throws(() => validateMeetingView({ ...view(), flags: { ...view().flags, roof: "true" } }));
  assert.throws(() => validateMeetingView({ ...view(), courtyardFinish: "wood" }));
  assert.throws(() => validateMeetingView({ ...view(), neighborCourtyardFinish: 1 }));
  assert.throws(() => validateMeetingView({ ...view(), roofStyle: "other" }));
  assert.throws(() => parseSession(JSON.stringify({ ...session, notes: { D99: session.notes.D04 } })));
  const other = emptySession();
  other.notes.D05 = { status: "未讨论", owner: "", due: "", body: "人行出口" };
  const merged = mergeSessions(session, other);
  assert.equal(merged.snapshots.length, 1);
  assert.equal(Object.keys(merged.notes).length, 2);
  assert.equal(session.notes.D05, undefined);
});
test("院坪铺装随快照回读，旧快照缺失选项时恢复普通水泥地", () => {
  const source = view();
  source.courtyardFinish = "tile";
  source.neighborCourtyardFinish = "concrete";
  const session = emptySession();
  session.snapshots.push({ id: "courtyard-material", title: "院坪铺砖", createdAt: "2026-10-15T00:00:00Z", revision: session.revision, view: source });
  assert.deepEqual(parseSession(JSON.stringify(session)), session);
  const { courtyardFinish: _own, neighborCourtyardFinish: _neighbor, ...legacy } = source;
  const restored = validateMeetingView(legacy);
  assert.equal(restored.courtyardFinish, "concrete");
  assert.equal(restored.neighborCourtyardFinish, "concrete");
});
test("官帽造型随会议JSON完整回读，旧快照恢复原有官帽", () => {
  const source = { ...view(), roofStyle: "floating" as const };
  const session = emptySession();
  session.snapshots.push({ id: "floating-roof", title: "悬浮官帽", createdAt: "2026-10-15T00:00:00Z", revision: session.revision, view: source });
  assert.deepEqual(parseSession(JSON.stringify(session)), session);
  const { roofStyle: _roof, ...legacy } = source;
  assert.equal(validateMeetingView(legacy).roofStyle, "joined");
  const html = meetingBooklet(session, { fenShui: 4.5, roadY: -1860, rampLength: 5000 }, source);
  assert.match(html, /悬浮官帽/);
  assert.ok(!html.includes("undefined"));
});
test("旧米制会议快照（道路标高／坡长／方案尺寸）读回时迁成毫米", () => {
  const legacy = {
    ...view(),
    roadY: -1.86,
    rampLength: 5,
    villaParams: { mainWidth: 13.5, mainDepth: 10, floor1Height: 3.6, roofFenShui: 4.5, gutterBedSlope: 1, rearGap: 1.2 },
  };
  const restored = validateMeetingView(legacy);
  assert.equal(restored.roadY, -1860);
  assert.equal(restored.rampLength, 5000);
  assert.equal(restored.villaParams.mainWidth, 13500);
  assert.equal(restored.villaParams.mainDepth, 10000);
  assert.equal(restored.villaParams.floor1Height, 3600);
  assert.equal(restored.villaParams.rearGap, 1200);
  // 非长度字段不乘 1000；未提供的字段保持默认毫米值。
  assert.equal(restored.villaParams.roofFenShui, 4.5);
  assert.equal(restored.villaParams.gutterBedSlope, 1);
  assert.equal(restored.villaParams.westGap, DEFAULT_VILLA_PARAMS.westGap);
  // 新毫米快照原样回读，不会被再放大。
  assert.deepEqual(validateMeetingView(view()).villaParams, DEFAULT_VILLA_PARAMS);
  assert.equal(validateMeetingView(view()).roadY, -1860);
});
test("旧会议快照缺方案尺寸时回落默认参数", () => {
  const { villaParams: _p, ...legacy } = view();
  const restored = validateMeetingView(legacy);
  assert.deepEqual(restored.villaParams, DEFAULT_VILLA_PARAMS);
});
test("导出图册转义会议内容，参数变化更新图纸，未知工程条件保持为空", () => {
  const session = emptySession();
  session.brief = '<img src=x onerror="alert(1)"><script>bad()</script>';
  const options = { fenShui: 4.5, roadY: -1860, rampLength: 5000 };
  const html = meetingBooklet(session, options, view());
  assert.ok(!html.includes(session.brief));
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.match(html, /最低梁底待联测/);
  assert.match(html, /切口协商待确认/);
  assert.match(html, /首层建筑面积合计（含门厅）/);
  assert.match(html, /136\.0＋32\.0＋9\.0＝177\.0㎡/);
  assert.doesNotMatch(html, /门厅[^<。]*另计/);
  assert.equal(html.match(/data-elevation="/g)?.length, 4);
  assert.match(html, /北立面（正立面）/);
  assert.ok(!/https?:\/\//.test(html.replaceAll('xmlns="http://www.w3.org/2000/svg"', "")));
  const base = designDrawings(options), changed = designDrawings({ ...options, fenShui: 6, roadY: -2500 });
  assert.equal(base.length, 5);
  assert.notEqual(base[0].svg, changed[0].svg);
  assert.notEqual(base[1].svg, changed[1].svg);
  assert.equal(base[2].svg, changed[2].svg);
  assert.deepEqual(unresolvedConditions, { roadSurveyElevation: null, lowestRetainedSoffitElevation: null, cutAgreementConfirmed: false, stairHeadroom: null, structuralCapacity: null, drainageDestination: null });
});
test("允许的坡道极值下，路线标高及车高带仍完整落在绘图区", () => {
  for (const roadY of [-3800, 0]) for (const rampLength of [3000, 10000]) {
    const svg = designDrawings({ fenShui: 10, roadY, rampLength })[1].svg;
    const polygon = svg.match(/<polygon points="([^"]+)" class="vehicle"/)!;
    assert.ok(polygon);
    for (const pair of polygon[1].split(" ")) {
      const [x, y] = pair.split(",").map(Number);
      assert.ok(Number.isFinite(x) && Number.isFinite(y));
      assert.ok(x >= 70 && x <= 920 && y >= 130 && y <= 300);
    }
  }
});
