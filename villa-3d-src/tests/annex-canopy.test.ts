import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { annexFlatRoofLayout } from "../src/annex-terrace";
import { terracePieceCorners } from "../src/annex-canopy";
import { annexChimneyModel, attachRoofs, roofPlanModel, villaLayoutFromDraft } from "../src/architecture";
import { applyVillaParams, getVillaParams, normalizeVillaParamsLengths, validateVillaParams, type VillaParams } from "../src/villa-params";
import { createEmptyScheme, parseSchemeDocument, schemeToJson } from "../src/scheme-store";
import { villaParamsPanelHtml } from "../src/villa-params-ui";
import { roofPlanSvg } from "../src/roof-plan";
import { elevationSvg } from "../src/elevation-plan";
import { site } from "../src/data";
import type { LayoutDraft } from "../src/layout-draft";
import type { Mats } from "../src/primitives";

const draft: LayoutDraft = JSON.parse(readFileSync(new URL("../data/户型/户型-20261023-210731.json", import.meta.url), "utf8")).layoutDraft;
function withCanopy(run: () => void, extra: Partial<VillaParams> = {}) {
  const before = getVillaParams();
  try { applyVillaParams({ ...before, annexRoofType: "flat", annexCanopy: "glass", ...extra }); run(); }
  finally { applyVillaParams(before); }
}

test("阳光雨棚缺省默认开启，选择随完整方案回读并拒绝无效类型", () => {
  assert.equal(normalizeVillaParamsLengths({}).annexCanopy, "glass");
  assert.equal(normalizeVillaParamsLengths({}).annexEave, 600);
  assert.equal(normalizeVillaParamsLengths({}).annexCorbelLength, 350);
  assert.equal(normalizeVillaParamsLengths({ annexCanopy: "off" }).annexCanopy, "off");
  const doc = createEmptyScheme();
  doc.villaParams.annexRoofType = "flat";
  doc.villaParams.annexCanopy = "glass";
  assert.equal(parseSchemeDocument(JSON.parse(schemeToJson(doc))).villaParams.annexCanopy, "glass");
  assert.ok(validateVillaParams({ ...doc.villaParams, annexCanopy: "invalid" } as unknown as VillaParams).some(i => i.field === "annexCanopy"));
  assert.match(villaParamsPanelHtml(doc.villaParams), /data-annex-canopy-options><div/);
  assert.match(villaParamsPanelHtml({ ...doc.villaParams, annexRoofType: "tiled" }), /data-annex-canopy-options hidden/);
});

test("开关仅控制平顶雨棚，关闭及瓦顶不残留构件，栏杆地面与原户型保持不变", () => withCanopy(() => {
  const params = getVillaParams(), original = JSON.stringify(draft);
  const enabled = annexFlatRoofLayout(draft.exteriorOpenings);
  assert.ok(enabled.canopy);
  applyVillaParams({ ...params, annexCanopy: "off" });
  const disabled = annexFlatRoofLayout(draft.exteriorOpenings);
  assert.equal(disabled.canopy, null);
  assert.deepEqual(enabled.pieces.filter(p => !p.name.startsWith("阳光雨棚")), disabled.pieces);
  assert.deepEqual(enabled.guards, disabled.guards);
  applyVillaParams({ ...params, annexRoofType: "tiled" });
  assert.equal(annexFlatRoofLayout(draft.exteriorOpenings).canopy, null);
  applyVillaParams(params);
  assert.deepEqual(annexFlatRoofLayout(draft.exteriorOpenings).canopy, enabled.canopy);
  assert.equal(JSON.stringify(draft), original);
}));

test("整片单坡玻璃顶覆盖三眼皮外沿及连接平台，烟管在棚外，落地柱不挡门", () => {
  for (const extra of [{}, { buildingPlacement: "main-west" as const }, { annexHeight: 4200, annexDepth: 7500, annexWidth: 3500 }])
    withCanopy(() => {
      const flat = annexFlatRoofLayout(draft.exteriorOpenings), c = flat.canopy!, chimney = annexChimneyModel();
      assert.ok(c.highY > c.lowY);
      assert.ok(c.lowY - flat.deckY >= 2400);
      const east = site.main.x > site.annex.x;
      const smokeClearance = east ? c.outerEdgeX - chimney.x - chimney.capDepth / 2
        : chimney.x - chimney.capDepth / 2 - c.outerEdgeX;
      assert.ok(smokeClearance >= 99, "烟管和防雨帽绕至棚沿收水槽之外");
      assert.ok(east ? c.x <= site.annex.x - site.eave - 150 : c.x + c.w >= site.annex.x + site.annex.w + site.eave + 150);
      assert.ok(c.z <= site.annex.z - site.eave - 150);
      assert.ok(c.z + c.d >= site.annex.z + site.annex.d + site.eave + 150);
      assert.ok(east ? c.x + c.w >= site.main.x - 3 : c.x <= site.main.x + site.main.w + 3);
      assert.ok(c.pieces.filter(p => p.finish === "canopyGlass").length >= 4);
      assert.equal(c.pieces.filter(p => p.name === "阳光雨棚落地立柱").length, 4, "两列各保留南北端柱");
      for (const p of c.pieces) {
        assert.ok(terracePieceCorners(p).flat().every(Number.isFinite));
        assert.ok(p.w > 0 && p.d > 0 && p.top > p.bottom);
        if (p.name === "阳光雨棚落地立柱") {
          assert.ok(p.x - p.w / 2 >= flat.footprint.x && p.x + p.w / 2 <= flat.footprint.x + flat.footprint.w);
          assert.ok(p.z - p.d / 2 >= flat.footprint.z && p.z + p.d / 2 <= flat.footprint.z + flat.footprint.d);
          if (Math.abs(p.x - (site.main.x > site.annex.x ? flat.footprint.x + flat.footprint.w - 570 : flat.footprint.x + 570)) < 1 && flat.doorZ != null)
            assert.ok(Math.abs(p.z - flat.doorZ) >= 900, "柱子不能落在门口连接平台内");
        }
      }
    }, extra);
});

test("真实三维雨棚斜率与共用角点一致，新增斜盒不修改其它屋顶共用几何", () => withCanopy(() => {
  const flat = annexFlatRoofLayout(draft.exteriorOpenings), root = new THREE.Group();
  const mats = new Proxy({} as Mats, { get(t, k: keyof Mats) { return t[k] ??= new THREE.MeshStandardMaterial() as never; } });
  attachRoofs(new THREE.Group(), root, mats, site.roofFenShui, "floating", villaLayoutFromDraft(draft));
  root.updateMatrixWorld(true);
  for (const name of ["阳光雨棚落地立柱", "阳光雨棚分格玻璃顶", "阳光雨棚顺坡梁", "阳光雨棚外侧收水槽底"]) {
    const mesh = root.getObjectByName(name) as THREE.Mesh;
    const p = flat.canopy!.pieces.find(p => p.name === name)!;
    const expected = new THREE.Box3().setFromPoints(terracePieceCorners(p).map(v => new THREE.Vector3(...v)));
    const actual = new THREE.Box3().setFromObject(mesh);
    assert.ok(actual.min.distanceTo(expected.min) < .01 && actual.max.distanceTo(expected.max) < .01);
  }
  assert.ok(root.getObjectByName("三眼皮檐口"));
  assert.ok(!root.getObjectByName("天沟槽底"));
  const first = root.getObjectByName("阳光雨棚分格玻璃顶") as THREE.Mesh;
  assert.notEqual(first.geometry, (root.getObjectByName("辅楼露台栏杆立柱") as THREE.Mesh).geometry);
}));

test("屋顶与四向立面同步玻璃棚、斜顶和总标高，关闭后恢复露台标高", () => withCanopy(() => {
  const flat = annexFlatRoofLayout(draft.exteriorOpenings), live = villaLayoutFromDraft(draft);
  assert.equal(roofPlanModel("floating", live).annexRidgePeak, flat.canopy!.peak);
  for (const view of ["slab", "floating"] as const) assert.match(roofPlanSvg(view, "floating", live), /data-annex-canopy="glass"/);
  for (const view of ["north", "south", "east", "west"] as const) {
    const svg = elevationSvg(view, "floating", live, false, "annex");
    assert.match(svg, /阳光雨棚顶/);
    assert.doesNotMatch(svg, /NaN/);
    const parts = [...svg.matchAll(/data-height-region="([^"]+)" data-height-bottom="([^"]+)" data-height-top="([^"]+)"/g)];
    assert.equal(parts.filter(p => p[1] !== "总高度").reduce((sum, p) => sum + Number(p[3]) - Number(p[2]), 0), Number(parts.find(p => p[1] === "总高度")![3]));
  }
  applyVillaParams({ ...getVillaParams(), annexCanopy: "off" });
  assert.equal(roofPlanModel("floating", live).annexRidgePeak, flat.deckY + 1100);
  assert.doesNotMatch(roofPlanSvg("floating", "floating", live), /data-annex-canopy="glass"/);
}));

test("栏杆靠近外边时，雨棚柱仍独立内收，玻璃顶覆盖栏杆上方", () => {
  for (const extra of [{}, { buildingPlacement: "main-west" as const }]) withCanopy(() => {
    const flat = annexFlatRoofLayout(draft.exteriorOpenings), r = flat.footprint, c = flat.canopy!;
    const frontRail = flat.guards.find(g => g.a[1] === g.b[1] && g.a[1] - r.z <= 100)!;
    assert.ok(c.z < frontRail.a[1], "棚沿探过前栏杆");
    assert.ok(c.z + c.d > r.z + r.d - 100, "棚沿覆盖后栏杆");
    for (const post of c.pieces.filter(p => p.name === "阳光雨棚落地立柱"))
      assert.ok(Math.min(post.x - r.x, r.x + r.w - post.x, post.z - r.z, r.z + r.d - post.z) >= 300,
        "承重柱不跟随栏杆挪到露台饰边");
  }, extra);
});

test("雨棚收水槽南北两端敞口排水，不设西向水嘴或垂地长管", () => {
  for (const extra of [{}, { buildingPlacement: "main-west" as const }, { annexEave: 1100 }]) withCanopy(() => {
    const c = annexFlatRoofLayout().canopy!, a = site.annex, east = site.main.x > a.x;
    assert.ok(east ? c.slopeX > 0 : c.slopeX < 0, "靠主楼高、外侧低");
    const outside = (x: number) => east ? x < a.x - site.eave - 20 : x > a.x + a.w + site.eave + 20;
    const drains = c.pieces.filter(p => /外排落水管|外向排水口|外侧收水槽/.test(p.name));
    assert.equal(c.outlets.length, 2);
    assert.equal(drains.filter(p => p.name === "阳光雨棚外排落水管").length, 0);
    assert.equal(drains.filter(p => p.name === "阳光雨棚外向排水口").length, 0);
    assert.ok(!c.pieces.some(p => p.name === "阳光雨棚收水槽端板"));
    assert.deepEqual(c.outlets, [{ x: c.drainX, z: c.z - 40 }, { x: c.drainX, z: c.z + c.d + 40 }]);
    for (const p of drains) {
      assert.ok(outside(p.x - p.w / 2) && outside(p.x + p.w / 2), `${p.name}不可落在楼板上`);
    }
    const floors = drains.filter(p => p.name === "阳光雨棚外侧收水槽底");
    assert.equal(floors.length, 2);
    assert.ok(floors[0].slopeZ! > 0 && floors[1].slopeZ! < 0, "槽底由中部向两端落水管找坡");
    assert.match(roofPlanSvg("floating", "floating"), /data-canopy-flow="outside"/);
  }, extra);
});
