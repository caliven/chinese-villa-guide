import { createHash } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { annexFlatRoofLayout, annexTerraceOpenings } from "../src/annex-terrace";
import { attachRoofs, roofPlanModel, roofSlabLayout, villaLayoutFromDraft } from "../src/architecture";
import { floors, site } from "../src/data";
import { resolveLayoutFacades } from "../src/facade-layout";
import type { LayoutDraft } from "../src/layout-draft";
import { floorPlan, planSourceFromDraft } from "../src/plan";
import { roofPlanSvg } from "../src/roof-plan";
import { elevationSvg } from "../src/elevation-plan";
import { createEmptyScheme, parseSchemeDocument, schemeToJson } from "../src/scheme-store";
import { applyVillaParams, getVillaParams, normalizeVillaParamsLengths, validateVillaParams, type VillaParams } from "../src/villa-params";
import type { Mats } from "../src/primitives";

function savedDraft(): LayoutDraft {
  return JSON.parse(readFileSync(new URL("../data/户型/户型-20261023-210731.json", import.meta.url), "utf8")).layoutDraft;
}
function withFlat(run: () => void, params: Partial<VillaParams> = {}) {
  const before = getVillaParams();
  try { applyVillaParams({ ...before, annexCanopy: "off", ...params, annexRoofType: "flat" }); run(); }
  finally { applyVillaParams(before); }
}

test("旧稿默认瓦顶，平顶选择随完整方案回读，无效类型被拒绝", () => {
  assert.equal(normalizeVillaParamsLengths({}).annexRoofType, "tiled");
  const doc = createEmptyScheme();
  doc.villaParams.annexRoofType = "flat";
  assert.equal(parseSchemeDocument(JSON.parse(schemeToJson(doc))).villaParams.annexRoofType, "flat");
  assert.ok(validateVillaParams({ ...doc.villaParams, annexRoofType: "bad" } as unknown as VillaParams).some(x => x.field === "annexRoofType"));
});

test("平顶只派生二楼朝辅楼的一樘门，平面与墙洞同步，切回瓦顶原窗完整恢复", () => {
  const draft = savedDraft(), original = JSON.stringify(draft);
  const before = getVillaParams();
  withFlat(() => {
    const derived = annexTerraceOpenings(draft.exteriorOpenings);
    const changed = derived.filter((item, i) => item !== draft.exteriorOpenings[i]);
    assert.equal(changed.length, 1);
    const door = changed[0];
    assert.equal(door.floor, 1); assert.equal(door.facadeIndex, 2);
    assert.equal(door.opening.kind, "door"); assert.equal(door.opening.width, 1200);
    assert.equal(door.opening.sill, 0);
    const wall = resolveLayoutFacades(draft).facades[1][2].openings.find(o => o.layoutSourceIndex === derived.indexOf(door))!;
    assert.equal(wall.door, true); assert.equal(wall.sill, 0); assert.equal(wall.h, 2200);
    assert.deepEqual(planSourceFromDraft(draft, 1).exteriorOpenings, derived);
    assert.equal(derived.find(item => item.floor === 1 && item.facadeIndex === 3)!.opening.kind, "window", "背向辅楼的东窗保持不变");
  });
  assert.equal(JSON.stringify(draft), original);
  applyVillaParams({ ...before, annexRoofType: "tiled" });
  assert.deepEqual(annexTerraceOpenings(draft.exteriorOpenings), draft.exteriorOpenings);
});

test("平顶沿用120屋面板、分离垫层铺装，平台接到露台外沿且不穿插楼板", () => withFlat(() => {
  const draft = savedDraft(), flat = annexFlatRoofLayout(draft.exteriorOpenings), slab = roofSlabLayout().annex;
  assert.equal(slab.thickness, 120);
  assert.equal(slab.top, site.annex.height + 120);
  assert.equal(flat.deckY, floors[1].y);
  const bedding = flat.pieces.find(p => p.name === "辅楼平顶露台垫层")!;
  assert.equal(bedding.bottom, slab.top); assert.equal(bedding.top, flat.deckY - 20);
  const bridge = flat.pieces.filter(p => p.name === "二楼通辅楼连接平台");
  assert.equal(bridge.length, 1);
  assert.equal(bridge[0].x - bridge[0].w / 2, flat.footprint.x + flat.footprint.w);
  assert.equal(bridge[0].x + bridge[0].w / 2, site.main.x);
  assert.equal(bridge[0].top, floors[1].y);
  const empty = annexFlatRoofLayout([]);
  assert.equal(empty.doorZ, null);
  assert.ok(!empty.pieces.some(p => p.name === "二楼通辅楼连接平台"));
}));

test("主辅楼换位及高辅楼下露台平台保持有效，护栏与铺装均为有限正尺寸", () => withFlat(() => {
  const flat = annexFlatRoofLayout(savedDraft().exteriorOpenings);
  assert.ok(site.annex.x > site.main.x);
  assert.ok(flat.deckY > floors[1].y);
  assert.ok(flat.pieces.filter(p => p.name === "二楼通辅楼连接平台").length > 1);
  for (const p of flat.pieces) {
    assert.ok([p.x, p.z, p.w, p.d, p.bottom, p.top].every(Number.isFinite));
    assert.ok(p.w > 0 && p.d > 0 && p.top > p.bottom);
  }
}, { buildingPlacement: "main-west", annexHeight: 4200 }));

test("平顶三维不生成辅楼瓦面木架，屋顶图及四向立面同步取消坡脊并保持高度分段连续", () => withFlat(() => {
  const draft = savedDraft(), live = villaLayoutFromDraft(draft);
  const mats = new Proxy({} as Mats, { get(target, key: keyof Mats) { return target[key] ??= new THREE.MeshStandardMaterial({ name: key }) as never; } });
  const main = new THREE.Group(), annex = new THREE.Group();
  attachRoofs(main, annex, mats, site.roofFenShui, "floating", live);
  assert.ok(annex.getObjectByName("辅楼平顶露台铺装"));
  assert.ok(annex.getObjectByName("二楼通辅楼连接平台"));
  assert.ok(!annex.getObjectByName("屋顶瓦片与木架"));
  const model = roofPlanModel("floating", live);
  assert.equal(model.annexFaces.length, 0); assert.equal(model.annexRidges.length, 0);
  assert.match(roofPlanSvg("floating", "floating", live), /辅楼平顶露台/);
  assert.match(floorPlan(1, false, false, {}, planSourceFromDraft(draft, 1)), /辅楼平顶露台/);
  for (const view of ["north", "south", "east", "west"] as const) {
    const svg = elevationSvg(view, "floating", live, false, "annex");
    assert.doesNotMatch(svg, /辅楼坡面脊线|脊瓦高度|NaN/);
    assert.match(svg, /平顶露台完成面|露台护栏/);
    const parts = [...svg.matchAll(/data-height-region="([^"]+)" data-height-bottom="([^"]+)" data-height-top="([^"]+)"/g)];
    const total = parts.find(p => p[1] === "总高度")!;
    assert.equal(parts.filter(p => p[1] !== "总高度").reduce((sum, p) => sum + Number(p[3]) - Number(p[2]), 0), Number(total[3]));
  }
}));


test("平顶保留三眼皮造型、取消全部天沟，铺装扩展且栏杆靠边", () => {
  const before = getVillaParams();
  const mats = new Proxy({} as Mats, { get(target, key: keyof Mats) { return target[key] ??= new THREE.MeshStandardMaterial({ name: key }) as never; } });
  const geometry = (root: THREE.Object3D) => {
    const hash = createHash("sha256");
    root.traverse(object => {
      hash.update(object.name);
      if (object instanceof THREE.Mesh) {
        for (const name of Object.keys(object.geometry.attributes).sort()) {
          const a = object.geometry.attributes[name].array;
          hash.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
        }
        const index = object.geometry.index?.array;
        if (index) hash.update(Buffer.from(index.buffer, index.byteOffset, index.byteLength));
      }
    });
    return hash.digest("hex");
  };
  try {
    for (const extra of [{}, { annexEave: 1100, annexGutterClearWidth: 450, annexGutterInnerDepth: 350, annexCorbelLength: 600 }]) {
      let eaves = "", slab: ReturnType<typeof roofSlabLayout>["annex"] | undefined;
      for (const annexRoofType of ["tiled", "flat"] as const) {
        applyVillaParams({ ...before, ...extra, annexRoofType });
        const root = new THREE.Group();
        attachRoofs(new THREE.Group(), root, mats);
        const common = root.getObjectByName(annexRoofType === "flat" ? "平顶三眼皮挑檐与梁托" : "四坡五脊瓦顶与环形天沟")!;
        assert.ok(common.getObjectByName("三眼皮檐口"));
        assert.equal(!!common.getObjectByName("天沟外边反坎压顶"), annexRoofType === "tiled");
        if (annexRoofType === "tiled") { eaves = geometry(common.getObjectByName("三眼皮檐口")!); slab = roofSlabLayout().annex; }
        else {
          assert.equal(geometry(common.getObjectByName("三眼皮檐口")!), eaves, "保留三眼皮阶梯");
          for (const name of ["天沟槽底", "天沟内挡边", "天沟外挡边", "天沟外边反坎压顶"])
            assert.ok(!root.getObjectByName(name), `${name}应取消`);
          const flat = annexFlatRoofLayout();
          assert.ok(flat.footprint.w > site.annex.w);
          assert.ok(flat.pieces.some(p => p.name === "辅楼露台深色收边"));
          assert.ok(flat.guards.every(g => Math.min(g.a[0], g.b[0]) > flat.footprint.x));
          assert.deepEqual(roofSlabLayout().annex, slab, "共用顶板不能叠盖三眼皮");
          assert.ok(!annexFlatRoofLayout().pieces.some(p => p.name === "辅楼平顶深色檐线"));
          const svg = elevationSvg("west", "floating", undefined, false, "annex");
          assert.match(svg, /平顶露台完成面/);
        }
      }
    }
  } finally { applyVillaParams(before); }
});

test("沿露台外边围合，四角共用顶装柱脚，门口与连接平台的栏杆连续", () => {
  for (const extra of [{}, { buildingPlacement: "main-west" as const }, { annexEave: 1100 }]) withFlat(() => {
    const flat = annexFlatRoofLayout(savedDraft().exteriorOpenings), r = flat.footprint;
    const horizontal = flat.guards.filter(g => g.a[1] === g.b[1]);
    const front = horizontal.reduce((a, b) => a.a[1] < b.a[1] ? a : b);
    const back = horizontal.reduce((a, b) => a.a[1] > b.a[1] ? a : b);
    assert.ok(front.a[1] > r.z && front.a[1] - r.z <= 100, "前栏杆贴近可用露台外边");
    assert.ok(back.a[1] < r.z + r.d && r.z + r.d - back.a[1] <= 100, "后栏杆贴近外边");
    assert.ok(Math.abs(front.b[0] - front.a[0]) >= r.w - 200, "不再留出两侧宽边带");
    const columns = flat.pieces.filter(p => p.name === "辅楼露台栏杆立柱");
    const bases = flat.pieces.filter(p => p.name === "辅楼露台栏杆顶装底座");
    for (const corner of [front.a, front.b, back.a, back.b]) {
      const at = (p: { x: number; z: number }) => Math.hypot(p.x - corner[0], p.z - corner[1]) < .01;
      assert.equal(columns.filter(at).length, 1, "转角不能叠两根柱子");
      assert.equal(bases.filter(at).length, 1, "转角只有一个底座");
    }
    for (const p of bases) {
      assert.ok(p.x - p.w / 2 >= r.x && p.x + p.w / 2 <= r.x + r.w);
      assert.ok(p.z - p.d / 2 >= r.z && p.z + p.d / 2 <= r.z + r.d);
    }
    const links = horizontal.filter(g => Math.max(g.a[0], g.b[0]) > r.x + r.w || Math.min(g.a[0], g.b[0]) < r.x);
    assert.equal(links.length, 2);
    for (const link of links) assert.ok(flat.guards.some(g => g.a[0] === g.b[0]
      && [g.a, g.b].some(p => Math.hypot(p[0] - link.b[0], p[1] - link.b[1]) < .01)), "桥栏直接接露台栏杆");
    const plate = roofSlabLayout().annex;
    assert.equal(plate.thickness, 120, "栏杆外移不改变室内结构板厚");
  }, extra);
});
