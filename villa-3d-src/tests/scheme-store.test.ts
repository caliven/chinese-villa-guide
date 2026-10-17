import test from "node:test";
import assert from "node:assert/strict";
import {
  createEmptyScheme,
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

test("非法 schema 拒绝", () => {
  assert.throws(() => parseSchemeDocument({ schema: "nope" }), /方案版本/);
});
