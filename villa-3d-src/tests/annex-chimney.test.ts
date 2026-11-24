import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { annexChimneyModel, buildVilla } from "../src/architecture";
import { site } from "../src/data";
import { resolveLayoutFacades } from "../src/facade-layout";
import { roofPlanSvg } from "../src/roof-plan";
import { annexFlatRoofLayout } from "../src/annex-terrace";
import { applyVillaParams, getVillaParams } from "../src/villa-params";
import type { Mats } from "../src/primitives";

const draft = JSON.parse(readFileSync(new URL("../data/户型/户型-20261023-210731.json", import.meta.url), "utf8")).layoutDraft;

test("两种屋顶及主辅楼换位时扁金属管下段均贴厨房外墙，且不挡现有窗", () => {
  const before = getVillaParams();
  try {
    for (const buildingPlacement of ["main-east", "main-west"] as const)
      for (const annexRoofType of ["tiled", "flat"] as const) {
        applyVillaParams({ ...before, buildingPlacement, annexRoofType });
        const c = annexChimneyModel(), a = site.annex;
        assert.equal(c.bottom, site.entranceRise);
        assert.equal(buildingPlacement === "main-east" ? a.x - c.wallX - c.bodyDepth / 2 : c.wallX - c.bodyDepth / 2 - a.x - a.w, 40);
        assert.ok(c.bodyWidth / c.bodyDepth >= 3, "扁管沿墙宽度应明显大于出墙厚度");
        assert.ok(c.z + c.bodyWidth / 2 < a.z + a.d);
        const wall = resolveLayoutFacades(draft).facades[3][1];
        for (const o of wall.openings) {
          const z = wall.a[1] + (wall.b[1] - wall.a[1]) * o.at / Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
          assert.ok(Math.abs(z - c.z) > (o.w + c.bodyWidth) / 2, "不能挡厨房或餐厅外窗");
        }
      }
  } finally { applyVillaParams(before); }
});

test("真实扁管网格从贴墙下段接入连续折弯上段，管身及薄防雨帽使用金属材质", () => {
  const before = getVillaParams();
  try {
    applyVillaParams({ ...before, annexRoofType: "flat" });
    const mats = new Proxy({} as Mats, { get(target, key: keyof Mats) { return target[key] ??= new THREE.MeshStandardMaterial({ name: key }) as never; } });
    const model = buildVilla(mats, false), c = annexChimneyModel();
    const lower = new THREE.Box3().setFromObject(model.annex.getObjectByName("辅楼外墙烟道下段")!);
    const upper = new THREE.Box3().setFromObject(model.annexRoof.getObjectByName("辅楼外墙烟道上段")!);
    assert.equal(lower.min.y, c.bottom);
    assert.equal(lower.max.y, upper.min.y);
    assert.equal(upper.max.y, c.capY - 140);
    assert.ok(Math.abs(upper.min.x - (c.x - c.bodyDepth / 2)) < .01);
    for (const [root, name] of [[model.annex, "辅楼外墙烟道下段"], [model.annexRoof, "辅楼外墙烟道上段"], [model.annexRoof, "辅楼金属烟管防雨帽"]] as const)
      assert.equal(((root.getObjectByName(name) as THREE.Mesh).material as THREE.Material).name, "flueMetal");
    assert.equal(lower.max.z - lower.min.z, c.bodyWidth);
    assert.equal(lower.max.x - lower.min.x, c.bodyDepth);
  } finally { applyVillaParams(before); }
});

test("顶板图和屋面图均标出外墙烟囱盖板同源投影", () => {
  for (const view of ["slab", "floating", "joined"] as const) {
    const c = annexChimneyModel(), svg = roofPlanSvg(view, "floating");
    assert.ok(svg.includes(`${Math.round(c.x - c.capDepth / 2)},${Math.round(c.z - c.capWidth / 2)}`));
    assert.match(svg, /class="roof-chimney"/);
  }
});

test("扁管从檐下折出，挑檐及满铺玻璃雨棚范围内不出现穿板直管", () => {
  const before = getVillaParams();
  try {
    for (const buildingPlacement of ["main-east", "main-west"] as const)
      for (const annexRoofType of ["tiled", "flat"] as const)
        for (const annexCanopy of ["off", "glass"] as const) {
          applyVillaParams({ ...before, buildingPlacement, annexRoofType, annexCanopy });
          const c = annexChimneyModel(), outer = c.wall + c.outward * (site.eave + 20);
          assert.ok(c.upperPath.some(([x, y]) => Math.abs(x - c.wallX) > 200 && y < site.annex.height - 400));
          for (const [x, y] of c.outline.filter(([, y]) => y >= site.annex.height - 400))
            assert.ok((x - outer) * c.outward >= 100, `不能穿入楼板或挑檐：${x},${y}`);
          assert.ok((c.x - c.wallX) * c.outward > site.eave);
        }
  } finally { applyVillaParams(before); }
});

test("金属烟管仅短出附近低檐，开启雨棚也不追随高边拔高", () => {
  const before = getVillaParams();
  try {
    for (const annexRoofType of ["tiled", "flat"] as const)
      for (const annexCanopy of ["off", "glass"] as const) {
        applyVillaParams({ ...before, annexRoofType, annexCanopy });
        const c = annexChimneyModel(), canopy = annexRoofType === "flat" ? annexFlatRoofLayout().canopy : null;
        assert.ok(c.capY + c.capThickness - (canopy?.lowY ?? c.base) <= 500);
        if (canopy) assert.ok(c.capY + c.capThickness < canopy.highY);
      }
  } finally { applyVillaParams(before); }
});
