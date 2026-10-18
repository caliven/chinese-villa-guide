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
    (w) => wallRoleOf(w) === "bearing" && Math.abs(w.a[0] - w.b[0]) < 20 && w.a[0] < 13000,
  );
  const eastBay = floors[1].partitions.find(
    (w) => wallRoleOf(w) === "bearing" && Math.abs(w.a[0] - w.b[0]) < 20 && w.a[0] > 14000,
  );
  assert.ok(westBay && eastBay);
  const midX = (westBay!.a[0] + eastBay!.a[0]) / 2;
  const midBay = floors[1].partitions.find(
    (w) => Math.abs(w.a[0] - midX) < 150 && Math.abs(w.b[0] - midX) < 150,
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

test("户型图外圈保留总尺寸与门厅柱心；接外墙内墙移动只改墙线定位", async () => {
  const { planSourceFromPublished, planSourceFromDraft, floorPlan: plan } = await import("../src/plan");
  const { clonePublishedLayout } = await import("../src/layout-draft");
  const { site } = await import("../src/data");
  const base = plan(1, false, false, {}, planSourceFromPublished(1));
  assert.match(base, /class="dim-mm"/);
  assert.doesNotMatch(base, /class="dim-mm"[^>]*>\d+\s*mm</);
  assert.match(base, /dim-tick-slash/);
  assert.match(base, />13600</);
  assert.match(base, />4600</);

  const draft = clonePublishedLayout();
  const vertical = draft.floors[1].partitions
    .filter((w) => Math.abs(w.a[0] - w.b[0]) < 20)
    .map((w) => w.a[0])
    .filter((x) => x > site.main.x + 300 && x < site.main.x + site.main.w - 300)
    .sort((a, b) => a - b);
  assert.ok(vertical.length >= 1);
  const fromX = vertical[0];
  const toX = Math.round(fromX + 700);
  for (const w of draft.floors[1].partitions) {
    if (Math.abs(w.a[0] - fromX) < 50) w.a = [toX, w.a[1]];
    if (Math.abs(w.b[0] - fromX) < 50) w.b = [toX, w.b[1]];
  }
  const moved = plan(1, false, false, {}, planSourceFromDraft(draft, 1));
  assert.match(moved, />13600</);
  assert.match(moved, />4600</);
  // 总宽与柱心控制不变；接外墙的墙线档可能随墙移动而变
  assert.match(moved, /data-dim-kind="control"/);
  assert.match(moved, /data-dim-kind="overall"/);
});
