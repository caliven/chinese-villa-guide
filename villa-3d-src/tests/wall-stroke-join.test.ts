import assert from "node:assert/strict";
import test from "node:test";
import { wallStrokeJoinExtend } from "../src/plan";

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≉ ${b}`);

test("直角 L 角：两端均伸出对侧半厚，外角可闭合", () => {
  const h = { a: [0, 0] as [number, number], b: [4000, 0] as [number, number] };
  const v = { a: [4000, 0] as [number, number], b: [4000, 3000] as [number, number] };
  const peers = [
    { a: h.a, b: h.b, thick: 240 },
    { a: v.a, b: v.b, thick: 240 },
  ];
  const he = wallStrokeJoinExtend(h, peers);
  const ve = wallStrokeJoinExtend(v, peers);
  near(he.start, 0);
  near(he.end, 120);
  near(ve.start, 120);
  near(ve.end, 0);
});

test("T 接：支墙伸出横墙半厚，横墙端不因支墙伸出", () => {
  const cross = { a: [0, 0] as [number, number], b: [6000, 0] as [number, number] };
  const stem = { a: [3000, 0] as [number, number], b: [3000, 2000] as [number, number] };
  const peers = [
    { a: cross.a, b: cross.b, thick: 240 },
    { a: stem.a, b: stem.b, thick: 120 },
  ];
  const se = wallStrokeJoinExtend(stem, peers);
  const ce = wallStrokeJoinExtend(cross, peers);
  near(se.start, 120);
  near(se.end, 0);
  near(ce.start, 0);
  near(ce.end, 0);
});

test("共线相接：不伸出半厚", () => {
  const a = { a: [0, 0] as [number, number], b: [3000, 0] as [number, number] };
  const b = { a: [3000, 0] as [number, number], b: [6000, 0] as [number, number] };
  const peers = [
    { a: a.a, b: a.b, thick: 120 },
    { a: b.a, b: b.b, thick: 120 },
  ];
  assert.deepEqual(wallStrokeJoinExtend(a, peers), { start: 0, end: 0 });
  assert.deepEqual(wallStrokeJoinExtend(b, peers), { start: 0, end: 0 });
});

test("不同厚度 L 角：伸出量取对侧墙厚一半", () => {
  const thick = { a: [0, 0] as [number, number], b: [4000, 0] as [number, number] };
  const thin = { a: [4000, 0] as [number, number], b: [4000, 2000] as [number, number] };
  const peers = [
    { a: thick.a, b: thick.b, thick: 240 },
    { a: thin.a, b: thin.b, thick: 120 },
  ];
  near(wallStrokeJoinExtend(thick, peers).end, 60);
  near(wallStrokeJoinExtend(thin, peers).start, 120);
});

test("端点已越过邻墙中线时只补到外皮，不额外凸出", () => {
  // 横墙端点已向竖墙外侧多出 40，只需再伸 80 到外皮（半厚 120）
  const h = { a: [0, 0] as [number, number], b: [4040, 0] as [number, number] };
  const v = { a: [4000, -2000] as [number, number], b: [4000, 2000] as [number, number] };
  const peers = [
    { a: h.a, b: h.b, thick: 240 },
    { a: v.a, b: v.b, thick: 240 },
  ];
  near(wallStrokeJoinExtend(h, peers).end, 80);
});
