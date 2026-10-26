import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyScheme, parseSchemeDocument } from "../src/scheme-store";
import { DEFAULT_VILLA_PARAMS, getVillaParams, validateVillaParams, type VillaParams } from "../src/villa-params";

test("几何数值参数拒绝错误类型及非有限数，防止导入后产生NaN实体", () => {
  const numericFields = Object.entries(DEFAULT_VILLA_PARAMS)
    .filter(([, value]) => typeof value === "number")
    .map(([key]) => key as keyof VillaParams);
  for (const field of numericFields) for (const value of ["bad", null, true, [], {}, NaN, Infinity, -Infinity]) {
    const params = { ...DEFAULT_VILLA_PARAMS, [field]: value } as VillaParams;
    assert.ok(validateVillaParams(params).some(issue => issue.field === field), `${field} 必须拒绝 ${String(value)}`);
  }
});

test("方案导入拒绝无效天沟压顶坡度，且不污染当前模型参数", () => {
  const before = getVillaParams();
  for (const value of ["bad", null, true, [], {}, NaN, Infinity, -Infinity, -1, 16]) {
    const doc = createEmptyScheme();
    const params = { ...doc.villaParams, gutterCopingSlope: value };
    assert.throws(() => parseSchemeDocument({ ...doc, villaParams: params }), /天沟顶面内倾/);
    assert.deepEqual(getVillaParams(), before);
  }
});

test("天沟压顶坡度零值、范围边界和旧稿缺项仍可载入", () => {
  for (const gutterCopingSlope of [0, 5.5, 15]) {
    const doc = createEmptyScheme();
    const params = { ...doc.villaParams, gutterCopingSlope };
    assert.equal(parseSchemeDocument({ ...doc, villaParams: params }).villaParams.gutterCopingSlope, gutterCopingSlope);
  }
  const doc = createEmptyScheme();
  const { gutterCopingSlope: omitted, ...params } = doc.villaParams;
  assert.equal(parseSchemeDocument({ ...doc, villaParams: params }).villaParams.gutterCopingSlope, omitted);
});
