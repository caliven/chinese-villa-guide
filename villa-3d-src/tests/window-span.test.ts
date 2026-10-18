import assert from "node:assert/strict";
import { test } from "node:test";
import {
  centeredWindowOnSpan,
  defaultWindowMaxRatio,
  facades,
} from "../src/facades.ts";

test("短墙窗宽随墙长收，不再出现约 1 m 窗配 1.8 m 墙", () => {
  const short = centeredWindowOnSpan(1800, 1800);
  assert.ok(short.w <= 720 + 1, `1800mm 墙窗宽应 ≤720，实际 ${short.w}`);
  assert.ok(short.w / 1800 <= 0.34 + 1e-9);
  assert.ok((1800 - short.w) / 2 >= 500 - 1, "两侧垛应 ≥500mm");

  const closet = centeredWindowOnSpan(2250, 1200);
  assert.ok(closet.w <= 750 + 1, `2250mm 段窗宽应偏小，实际 ${closet.w}`);
  assert.ok(closet.w / 2250 <= 0.34 + 1e-9);
});

test("常规 4.5 m 开间仍可选到 1.8 m 主流窗宽", () => {
  const bay = centeredWindowOnSpan(4500, 1800);
  assert.equal(bay.w, 1800);
  assert.ok(Math.abs(bay.at - 2250) < 1);
});

test("立面外窗相对所在墙段比例不过高", () => {
  for (const floor of [0, 1, 2, 3]) {
    for (const wall of facades(floor)) {
      const len = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
      for (const o of wall.openings) {
        if (o.door || o.open) continue;
        assert.ok(
          o.w / len <= defaultWindowMaxRatio(len) + 0.02 + 1e-9,
          `F${floor} 窗宽 ${o.w} / 墙长 ${len.toFixed(0)} = ${(o.w / len).toFixed(2)} 过高`,
        );
      }
    }
  }
});
