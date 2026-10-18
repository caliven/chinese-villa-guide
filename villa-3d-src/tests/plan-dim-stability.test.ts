import assert from "node:assert/strict";
import { test } from "node:test";
import { site } from "../src/data.ts";
import { clonePublishedLayout } from "../src/layout-draft.ts";
import { floorPlan, planSourceFromDraft } from "../src/plan.ts";
import { collectPlanSiteDimensions } from "../src/plan-dimensions.ts";

const mainViewBox = (svg: string) => svg.match(/<svg data-plan-building="main"[^>]*viewBox="([^"]+)"/)?.[1];

test("拖墙新增或移除定位档时图纸坐标系不变，避免指针换算跳位", () => {
  const draft = clonePublishedLayout();
  const x = site.main.x + site.main.w / 3;
  draft.floors[0]!.partitions = [{ a: [x, site.main.z], b: [x, site.main.z + 800] }];
  const before = floorPlan(0, false, false, {}, planSourceFromDraft(draft, 0));
  draft.floors[0]!.partitions[0]!.a[0] += 700;
  draft.floors[0]!.partitions[0]!.b[0] += 700;
  const after = floorPlan(0, false, false, {}, planSourceFromDraft(draft, 0));
  assert.ok(mainViewBox(before));
  assert.equal(mainViewBox(after), mainViewBox(before));
  assert.notEqual(after, before, "墙线定位仍应更新");
});

test("拖房间和墙体不改变统一场地分配，单栋图总尺寸分别闭合", () => {
  const draft = clonePublishedLayout();
  const before = collectPlanSiteDimensions();
  for (const room of [...draft.floors[0]!.rooms, ...draft.annexRooms]) {
    room.x -= 120; room.w += 200;
  }
  draft.floors[0]!.partitions[0]!.a[0] -= 10;
  assert.deepEqual(collectPlanSiteDimensions(), before);
  assert.deepEqual(before.widthSegmentsMm, [800, 4000, 1800, 13600, 800]);
  assert.equal(before.widthSegmentsMm.reduce((a, b) => a + b, 0), before.totalWidthMm);
  const rendered = floorPlan(0, false, false, {}, planSourceFromDraft(draft, 0));
  for (const [building, total] of [["main", 13600], ["annex", 4000]] as const) {
    const svg = rendered.match(new RegExp(`<svg data-plan-building="${building}"[\\s\\S]*?</svg>`))?.[0];
    assert.ok(svg);
    // 总宽只在北侧；南侧若有墙距链，分段之和仍须闭合到同一总宽。
    const overall = svg.match(/<g data-dim-side="north" data-dim-kind="overall">([\s\S]*?)<\/g>/)?.[1];
    assert.ok(overall, `${building} 北侧缺外轮廓总宽`);
    assert.equal(
      [...overall!.matchAll(/class="dim-mm"[^>]*>(\d+)</g)].map((m) => Number(m[1])).reduce((a, b) => a + b, 0),
      total,
      `${building} north overall`,
    );
    assert.ok(!svg.includes('data-dim-side="south" data-dim-kind="overall"'));
    for (const side of ["north", "south"] as const) {
      const group = svg.match(new RegExp(`<g data-dim-side="${side}" data-dim-kind="walls">([\\s\\S]*?)</g>`))?.[1];
      if (!group) continue;
      const segments = [...group.matchAll(/class="dim-mm"[^>]*>(\d+)</g)].map((m) => Number(m[1]));
      assert.equal(segments.reduce((a, b) => a + b, 0), total, `${building} ${side} walls`);
    }
  }
});
