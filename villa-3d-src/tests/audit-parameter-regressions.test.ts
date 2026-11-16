import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_VILLA_PARAMS, applyVillaParams, normalizeVillaParamsLengths, resetVillaParams, validateVillaParams } from "../src/villa-params.ts";
import { neighborCourtyardPlan } from "../src/data.ts";
import { surroundings } from "../src/surroundings.ts";
import { gutterInnerWallTop, gutterOuterWallTop } from "../src/roof-options.ts";

test("审查回归：可应用的层高和门厅参数遵循户型回读范围", () => {
  for (const changes of [{ floor2Height: 6500 }, { floor2Height: 1000 }, { porticoProjection: 4500 }, { porticoWidth: 8200 }, { partition: 30000 }]) {
    assert.ok(validateVillaParams({ ...DEFAULT_VILLA_PARAMS, ...changes }).length > 0);
  }
  assert.deepEqual(validateVillaParams({ ...DEFAULT_VILLA_PARAMS, entranceRise: 0 }), []);
});

test("审查回归：天沟外溢按压顶最高点校验，旧默认迁移", () => {
  try {
    applyVillaParams(DEFAULT_VILLA_PARAMS);
    assert.ok(gutterInnerWallTop() > gutterOuterWallTop());
    const old = normalizeVillaParamsLengths({ ...DEFAULT_VILLA_PARAMS, gutterInnerDepth: 250, annexGutterInnerDepth: 250 });
    assert.equal(old.gutterInnerDepth, 280);
    assert.equal(old.annexGutterInnerDepth, 280);
    assert.ok(validateVillaParams({ ...DEFAULT_VILLA_PARAMS, gutterInnerDepth: 250 }).some(issue => issue.field === "gutterInnerDepth"));
  } finally { resetVillaParams(); }
});

test("审查回归：异常找坡值在正规化后仍被拒绝", () => {
  for (const value of ["bad", null, true, -4, 16]) {
    const params = normalizeVillaParamsLengths({ ...DEFAULT_VILLA_PARAMS, gutterBedSlope: value } as never);
    assert.ok(validateVillaParams(params).some(issue => issue.field === "gutterBedSlope"));
  }
});

test("审查回归：邻房平面定位采用实际三维前墙及水泥地锚点", () => {
  try {
    for (const neighborCementDepth of [2000, 3000]) {
      applyVillaParams({ ...DEFAULT_VILLA_PARAMS, neighborCementDepth });
      assert.equal(neighborCourtyardPlan.x, surroundings.sideHouse.x);
      assert.equal(neighborCourtyardPlan.cementFront + neighborCourtyardPlan.cementDepth, surroundings.sideHouse.z);
    }
  } finally { resetVillaParams(); }
});
