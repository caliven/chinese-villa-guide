import test from "node:test";
import assert from "node:assert/strict";
import {
  createEmptyScheme,
  formatSavedAt,
  formatSavedAtDisplay,
  makeVersionId,
  parseSchemeDocument,
  schemeSchema,
  schemeToJson,
} from "../src/scheme-store";
import { DEFAULT_VILLA_PARAMS } from "../src/villa-params";

test("空方案可序列化并回读", () => {
  const doc = createEmptyScheme("测试");
  assert.equal(doc.schema, schemeSchema);
  assert.deepEqual(doc.villaParams.mainWidth, DEFAULT_VILLA_PARAMS.mainWidth);
  const again = parseSchemeDocument(JSON.parse(schemeToJson(doc)));
  assert.equal(again.title, "测试");
  assert.equal(again.villaParams.mainDepth, DEFAULT_VILLA_PARAMS.mainDepth);
  assert.equal(again.layoutDraft, null);
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
