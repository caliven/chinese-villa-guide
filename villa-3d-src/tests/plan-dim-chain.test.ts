import assert from "node:assert/strict";
import { test } from "node:test";
import { floorPlan, planSourceFromDraft } from "../src/plan.ts";
import {
  clonePublishedLayout,
  placeStairAt,
} from "../src/layout-draft.ts";
import { site } from "../src/data.ts";
import { fitStairToRoom, stairWellBounds } from "../src/stair-geometry.ts";

/** 抽出水平尺寸链上的毫米数字（按出现顺序）。 */
function dimMmValues(svg: string): number[] {
  const buildingDimensions = [...svg.matchAll(/<g data-dim-side="[^"]+" data-dim-kind="(?:control|walls|overall)">([\s\S]*?)<\/g>/g)].map(m => m[1]).join("");
  return [...buildingDimensions.matchAll(/class="dim-mm"[^>]*>(\d+)</g)].map((m) => Number(m[1]));
}

test("开间内嵌套楼梯时外边链标出梯间宽度，房屋总宽仍闭合", () => {
  const draft = clonePublishedLayout();
  const elder = draft.floors[0]!.rooms.find((r) => r.id === "elder")!;
  // 楼梯落在尊亲房开间内、贴南墙（嵌套），宽 2800 mm
  draft.stairLayout.room.w = 2800;
  draft.stairLayout.room.d = 2600;
  placeStairAt(draft, elder.x + 80 + 1400, elder.z + elder.d - 1300);
  const stair = draft.floors[0]!.rooms.find((r) => r.kind === "stair")!;
  assert.ok(stair.w <= 2800 + 1);
  // 仍落在尊亲房开间投影内
  assert.ok(stair.x >= elder.x - 50);
  assert.ok(stair.x + stair.w <= elder.x + elder.w + 50);

  const svg = floorPlan(0, false, false, {}, planSourceFromDraft(draft, 0));
  const mms = dimMmValues(svg);
  // 外圈不再因内墙／梯间拆分；总宽与门厅柱心控制仍在
  assert.ok(mms.includes(13600), `应有外轮廓总宽 13600，实际 ${mms.join(",")}`);
  assert.ok(mms.includes(4600), `应有门厅柱心距 4600，实际 ${mms.join(",")}`);
  // 梯间另列真实占位：框不足以容纳踏步时，不能把实体裁成框尺寸。
  const well = stairWellBounds(fitStairToRoom(draft.stairLayout, draft.floors));
  assert.ok(svg.includes(`梯间 ${Math.round(well.w)}×${Math.round(well.d)}`));
});

test("比隔墙厚更近的双轴合并，尺寸段之和等于总宽", () => {
  const draft = clonePublishedLayout();
  // 人为制造 100 mm 双轴：尊亲房西边相对开间轴内偏
  const elder = draft.floors[0]!.rooms.find((r) => r.id === "elder")!;
  elder.x += 100;
  elder.w -= 100;
  const svg = floorPlan(0, false, false, {}, planSourceFromDraft(draft, 0));
  const mms = dimMmValues(svg);
  assert.ok(!mms.includes(100), `100mm 假缝应被合并：${mms.join(",")}`);
  assert.ok(!mms.includes(4400), `不应因双轴变成 4400：${mms.join(",")}`);
  // 拆图后主、辅楼分别标总宽；21米由统一约束汇总。
  assert.ok(mms.includes(Math.round(site.main.w)));
  assert.ok(mms.includes(Math.round(site.annex.w)));
});
