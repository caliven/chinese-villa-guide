import test from "node:test";
import assert from "node:assert/strict";
import {
  createEmptyScheme,
  isMeterSchemePayload,
  migrateSchemeRawToMm,
  formatSavedAt,
  formatSavedAtDisplay,
  makeVersionId,
  parseSchemeDocument,
  schemeSchema,
  schemeToJson,
} from "../src/scheme-store";
import { clonePublishedLayout } from "../src/layout-draft";
import { LENGTH_UNITS, VILLA_PARAM_NON_LENGTH } from "../src/units";
import { DEFAULT_VILLA_PARAMS, LOCKED_SITE_WIDTH } from "../src/villa-params";

/** 把毫米稿还原成旧米制 JSON（长度 ÷1000；角度／序号／踏步数保持原值）。 */
const KEEP_AS_IS = new Set(["schema", "rotation", "floor", "facadeIndex", "risers", ...VILLA_PARAM_NON_LENGTH]);
function toMetersDeep(value: unknown): unknown {
  if (typeof value === "number") return value / 1000;
  if (Array.isArray(value)) return value.map(toMetersDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) =>
        KEEP_AS_IS.has(k) || typeof v !== "number" && typeof v !== "object" ? [k, v] : [k, toMetersDeep(v)],
      ),
    );
  }
  return value;
}
function assertClose(actual: unknown, expected: unknown, path = "$") {
  if (typeof expected === "number") {
    assert.ok(typeof actual === "number" && Math.abs(actual - expected) < 1e-6, `${path}：${actual} ≠ ${expected}`);
  } else if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual) && actual.length === expected.length, `${path} 长度`);
    expected.forEach((v, i) => assertClose((actual as unknown[])[i], v, `${path}[${i}]`));
  } else if (expected && typeof expected === "object") {
    for (const [k, v] of Object.entries(expected)) assertClose((actual as Record<string, unknown>)[k], v, `${path}.${k}`);
  } else {
    assert.equal(actual, expected, path);
  }
}

test("空方案可序列化并回读", () => {
  const doc = createEmptyScheme("测试");
  assert.equal(doc.schema, schemeSchema);
  assert.deepEqual(doc.villaParams.mainWidth, DEFAULT_VILLA_PARAMS.mainWidth);
  const again = parseSchemeDocument(JSON.parse(schemeToJson(doc)));
  assert.equal(again.title, "测试");
  assert.equal(again.villaParams.mainDepth, DEFAULT_VILLA_PARAMS.mainDepth);
  assert.equal(again.layoutDraft, null);
});

test("方案总宽锁定 21000 mm，默认参数全为毫米整数", () => {
  assert.equal(LOCKED_SITE_WIDTH, 21000);
  assert.equal(DEFAULT_VILLA_PARAMS.mainWidth, 13600);
  assert.equal(
    DEFAULT_VILLA_PARAMS.westGap + DEFAULT_VILLA_PARAMS.annexWidth + DEFAULT_VILLA_PARAMS.lane + DEFAULT_VILLA_PARAMS.mainWidth + DEFAULT_VILLA_PARAMS.eastGap,
    LOCKED_SITE_WIDTH,
  );
  assert.equal(createEmptyScheme().units, LENGTH_UNITS);
});

test("旧米制方案（无 units）读回时 villaParams／户型草稿／院坪尺寸线全部迁成毫米", () => {
  const draft = clonePublishedLayout();
  const meterDoc = {
    schema: schemeSchema,
    id: "legacy",
    title: "旧米制稿",
    savedAt: "2026-10-16T12:00:00+08:00",
    villaParams: toMetersDeep(DEFAULT_VILLA_PARAMS),
    layoutDraft: toMetersDeep(JSON.parse(JSON.stringify(draft))),
    courtyardDimLayout: { "v-setback": 1.5, "h-front": -0.8 },
  } as Record<string, unknown>;
  // 迁移前确为米制：面宽随默认、分水 4.5 不动。
  const mp = meterDoc.villaParams as Record<string, number>;
  assert.equal(mp.mainWidth, DEFAULT_VILLA_PARAMS.mainWidth / 1000);
  assert.equal(mp.roofFenShui, 4.5);
  assert.equal(isMeterSchemePayload(meterDoc), true);
  assert.equal(migrateSchemeRawToMm(meterDoc).units, LENGTH_UNITS);

  const doc = parseSchemeDocument(meterDoc);
  assert.equal(doc.units, LENGTH_UNITS);
  assert.equal(doc.villaParams.mainWidth, DEFAULT_VILLA_PARAMS.mainWidth);
  assert.equal(doc.villaParams.mainDepth, 10000);
  assert.equal(doc.villaParams.floor1Height, 3600);
  assert.equal(doc.villaParams.rearGap, 1200);
  // 非长度字段不被放大
  assert.equal(doc.villaParams.roofFenShui, 4.5);
  assert.equal(doc.villaParams.gutterBedSlope, DEFAULT_VILLA_PARAMS.gutterBedSlope);
  assertClose(doc.villaParams, DEFAULT_VILLA_PARAMS);
  assert.deepEqual(doc.courtyardDimLayout, { "v-setback": 1500, "h-front": -800 });
  assert.ok(doc.layoutDraft);
  assert.equal(doc.layoutDraft!.floors[0]!.height, 3600);
  assert.equal(doc.layoutDraft!.floors[0]!.rooms[0]!.w, draft.floors[0]!.rooms[0]!.w);
  assertClose(doc.layoutDraft!.floors[0]!.rooms, draft.floors[0]!.rooms);
  assertClose(doc.layoutDraft!.floors[1]!.partitions, draft.floors[1]!.partitions);
  assert.equal(doc.layoutDraft!.stairLayout.risers, draft.stairLayout.risers);
  assertClose(doc.layoutDraft!.stairLayout, draft.stairLayout);
});

test("毫米方案（units=mm）读回不再被放大，且序列化稳定", () => {
  const draft = clonePublishedLayout();
  const mmDoc = { ...createEmptyScheme("毫米稿"), layoutDraft: draft };
  const again = parseSchemeDocument(JSON.parse(schemeToJson(mmDoc)));
  assert.equal(again.villaParams.mainWidth, DEFAULT_VILLA_PARAMS.mainWidth);
  assert.equal(again.layoutDraft!.floors[0]!.height, draft.floors[0]!.height);
  // 缺 units 但数值明显为毫米：靠 mainWidth／层高量级判定，不二次放大。
  const noUnits = JSON.parse(schemeToJson(mmDoc)) as Record<string, unknown>;
  delete noUnits.units;
  assert.equal(isMeterSchemePayload(noUnits), false);
  assert.equal(parseSchemeDocument(noUnits).villaParams.mainWidth, DEFAULT_VILLA_PARAMS.mainWidth);
});

test("版本 id 为时间戳格式", () => {
  const id = makeVersionId();
  assert.match(id, /^\d{8}-\d{6}$/);
});

test("savedAt 为北京时间 +08:00，与版本 id 同时段一致", () => {
  const now = new Date("2026-10-17T04:17:42.122Z"); // UTC → 北京 12:17:42
  assert.equal(formatSavedAt(now), "2026-10-17T12:17:42+08:00");
  assert.equal(makeVersionId(now), "20261017-121742");
  assert.equal(formatSavedAtDisplay("2026-10-17T04:17:42.122Z"), "2026-10-17 12:17");
  assert.equal(formatSavedAtDisplay("2026-10-17T12:17:42+08:00", true), "2026-10-17 12:17:42");
});

test("非法 schema 拒绝", () => {
  assert.throws(() => parseSchemeDocument({ schema: "nope" }), /方案版本/);
});
