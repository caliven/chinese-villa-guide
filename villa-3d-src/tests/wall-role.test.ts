import test from "node:test";
import assert from "node:assert/strict";
import { floors, wallRoleOf } from "../src/data";
import { floorPlan } from "../src/plan";

test("默认户型内墙已标注承重／隔墙，平面可区分", () => {
  const counts = floors.map((f) => ({
    bearing: f.partitions.filter((w) => wallRoleOf(w) === "bearing").length,
    partition: f.partitions.filter((w) => wallRoleOf(w) === "partition").length,
  }));
  assert.ok(counts.every((c) => c.bearing > 0 && c.partition > 0));
  // 开间中缝衣帽墙（约两开间轴正中）不得标成承重
  const westBay = floors[1].partitions.find(
    (w) => wallRoleOf(w) === "bearing" && Math.abs(w.a[0] - w.b[0]) < 0.02 && w.a[0] < 13,
  );
  const eastBay = floors[1].partitions.find(
    (w) => wallRoleOf(w) === "bearing" && Math.abs(w.a[0] - w.b[0]) < 0.02 && w.a[0] > 14,
  );
  assert.ok(westBay && eastBay);
  const midX = (westBay!.a[0] + eastBay!.a[0]) / 2;
  const midBay = floors[1].partitions.find(
    (w) => Math.abs(w.a[0] - midX) < 0.15 && Math.abs(w.b[0] - midX) < 0.15,
  );
  assert.ok(midBay);
  assert.equal(wallRoleOf(midBay!), "partition");
  const svg = floorPlan(0);
  assert.match(svg, /bearing-wall/);
  assert.match(svg, /class="partition"/);
  assert.match(svg, /墙示意/);
  // 户型图门头朝下：内容组旋转 180°
  assert.match(svg, /class="plan-world" transform="rotate\(180/);
  assert.match(svg, /门头朝下/);
});

test("户型图四边链式墙距为毫米，并随隔墙位置变化", async () => {
  const { planSourceFromPublished, planSourceFromDraft, floorPlan: plan } = await import("../src/plan");
  const { clonePublishedLayout } = await import("../src/layout-draft");
  const { site } = await import("../src/data");
  const base = plan(1, false, false, {}, planSourceFromPublished(1));
  assert.match(base, /class="dim-mm"/);
  assert.match(base, /单位 mm/);
  assert.match(base, /dim-tick-slash/);
  // 主楼面宽 13.5 m → 外档总宽 13500
  assert.match(base, />13500</);

  const draft = clonePublishedLayout();
  // 取二层西侧第一道竖向内墙轴（参数同步后未必仍是 11.3）
  const vertical = draft.floors[1].partitions
    .filter((w) => Math.abs(w.a[0] - w.b[0]) < 0.02)
    .map((w) => w.a[0])
    .filter((x) => x > site.main.x + 0.3 && x < site.main.x + site.main.w - 0.3)
    .sort((a, b) => a - b);
  assert.ok(vertical.length >= 1);
  const fromX = vertical[0];
  const toX = Number((fromX + 0.7).toFixed(2));
  for (const w of draft.floors[1].partitions) {
    if (Math.abs(w.a[0] - fromX) < 0.05) w.a = [toX, w.a[1]];
    if (Math.abs(w.b[0] - fromX) < 0.05) w.b = [toX, w.b[1]];
  }
  for (const r of draft.floors[1].rooms) {
    if (Math.abs(r.x - fromX) < 0.05) {
      r.w = Number((r.w + r.x - toX).toFixed(3));
      r.x = toX;
    } else if (Math.abs(r.x + r.w - fromX) < 0.05) {
      r.w = Number((toX - r.x).toFixed(3));
    }
  }
  const westSeg = Math.round((toX - site.main.x) * 1000);
  const moved = plan(1, false, false, {}, planSourceFromDraft(draft, 1));
  assert.match(moved, new RegExp(`>${westSeg}<`));
  // 默认北侧西开间为 4500；挪轴后应变为 westSeg（且与 4500 不同）
  assert.notEqual(westSeg, 4500);
  assert.match(base, />4500</);
});
