import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLayoutVersionDocument,
  buildSizeVersionDocument,
  layoutDocSchema,
  makeDataVersionTitle,
  parseDataVersionsIndex,
  parseLayoutVersionDocument,
  parseSizeVersionDocument,
  removeVersionMeta,
  safeDataVersionFileName,
  sizeDocSchema,
  sizeDocToJson,
  layoutDocToJson,
} from "../src/data-versions";
import { clonePublishedLayout } from "../src/layout-draft";
import { LENGTH_UNITS, VILLA_PARAM_NON_LENGTH } from "../src/units";
import { DEFAULT_VILLA_PARAMS, applyVillaParams } from "../src/villa-params";

test("尺寸版本标题带中文前缀与日期编号", () => {
  const title = makeDataVersionTitle("尺寸", new Date(2026, 9, 17, 12, 34, 56));
  assert.equal(title, "尺寸-20261017-123456");
});

test("户型版本标题带中文前缀与日期编号", () => {
  const title = makeDataVersionTitle("户型", new Date(2026, 9, 17, 12, 34, 56));
  assert.equal(title, "户型-20261017-123456");
});

test("尺寸版本可序列化并回读", () => {
  applyVillaParams(DEFAULT_VILLA_PARAMS);
  const doc = buildSizeVersionDocument({ title: "尺寸-测试", id: "尺寸-测试" });
  assert.equal(doc.schema, sizeDocSchema);
  const again = parseSizeVersionDocument(JSON.parse(sizeDocToJson(doc)));
  assert.equal(again.title, "尺寸-测试");
  assert.equal(again.villaParams.mainWidth, DEFAULT_VILLA_PARAMS.mainWidth);
});

test("户型版本一二三楼一体存取", () => {
  const draft = clonePublishedLayout();
  assert.equal(draft.floors.length, 3);
  const doc = buildLayoutVersionDocument(draft, { title: "户型-测试", id: "户型-测试" });
  assert.equal(doc.schema, layoutDocSchema);
  const again = parseLayoutVersionDocument(JSON.parse(layoutDocToJson(doc)));
  assert.equal(again.layoutDraft.floors.length, 3);
  assert.equal(again.layoutDraft.floors[0]?.name, draft.floors[0]?.name);
});

test("户型版本拒绝不足三层", () => {
  const draft = clonePublishedLayout();
  draft.floors = draft.floors.slice(0, 2);
  assert.throws(() => buildLayoutVersionDocument(draft), /三层/);
});

test("版本目录可解析", () => {
  const index = parseDataVersionsIndex(
    {
      schema: "anhua-villa-data-versions-v1",
      kind: "户型",
      versions: [{ id: "户型-1", title: "户型-1", savedAt: "2026-10-17T00:00:00.000Z", file: "户型-1.json" }],
    },
    "户型",
  );
  assert.equal(index.versions.length, 1);
  assert.equal(index.versions[0]?.file, "户型-1.json");
});

test("可从目录去掉指定版本文件", () => {
  const index = parseDataVersionsIndex(
    {
      schema: "anhua-villa-data-versions-v1",
      kind: "尺寸",
      versions: [
        { id: "尺寸-a", title: "尺寸-a", savedAt: "2026-10-17T12:00:00+08:00", file: "尺寸-a.json" },
        { id: "尺寸-b", title: "尺寸-b", savedAt: "2026-10-17T13:00:00+08:00", file: "尺寸-b.json" },
      ],
    },
    "尺寸",
  );
  const next = removeVersionMeta(index, "尺寸-a.json");
  assert.equal(next.versions.length, 1);
  assert.equal(next.versions[0]?.file, "尺寸-b.json");
  assert.equal(safeDataVersionFileName("../x.json"), null);
  assert.equal(safeDataVersionFileName("index.json"), null);
  assert.equal(safeDataVersionFileName("尺寸-a.json"), "尺寸-a.json");
});

/** 把毫米稿还原成旧米制 JSON（长度 ÷1000；角度／序号／踏步数保持原值）。 */
const KEEP_AS_IS = new Set(["schema", "rotation", "floor", "facadeIndex", "risers", ...VILLA_PARAM_NON_LENGTH]);
function toMetersDeep(value: unknown): unknown {
  if (typeof value === "number") return value / 1000;
  if (Array.isArray(value)) return value.map(toMetersDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) =>
        KEEP_AS_IS.has(k) || (typeof v !== "number" && typeof v !== "object") ? [k, v] : [k, toMetersDeep(v)],
      ),
    );
  }
  return value;
}

test("新建版本文档标注 units=mm，长度为毫米整数量级", () => {
  applyVillaParams(DEFAULT_VILLA_PARAMS);
  const size = buildSizeVersionDocument({ title: "尺寸-mm", id: "尺寸-mm" });
  assert.equal(size.units, LENGTH_UNITS);
  assert.equal(size.villaParams.mainWidth, DEFAULT_VILLA_PARAMS.mainWidth);
  const layout = buildLayoutVersionDocument(clonePublishedLayout(), { title: "户型-mm", id: "户型-mm" });
  assert.equal(layout.units, LENGTH_UNITS);
  assert.equal(layout.layoutDraft.floors[0]!.height, 3600);
});

test("旧米制尺寸版本读回迁成毫米；毫米版本不二次放大", () => {
  applyVillaParams(DEFAULT_VILLA_PARAMS);
  const mm = JSON.parse(sizeDocToJson(buildSizeVersionDocument({ title: "尺寸-旧", id: "尺寸-旧" }))) as Record<string, unknown>;
  const meter: Record<string, unknown> = {
    ...mm,
    villaParams: toMetersDeep(mm.villaParams),
    courtyardDimLayout: { "v-setback": 1.5 },
  };
  delete meter.units;
  const params = meter.villaParams as Record<string, number>;
  assert.equal(params.mainWidth, DEFAULT_VILLA_PARAMS.mainWidth / 1000);
  assert.equal(params.roofFenShui, 4.5);
  const migrated = parseSizeVersionDocument(meter);
  assert.equal(migrated.units, LENGTH_UNITS);
  assert.equal(migrated.villaParams.mainWidth, DEFAULT_VILLA_PARAMS.mainWidth);
  assert.equal(migrated.villaParams.mainDepth, 10000);
  assert.equal(migrated.villaParams.thirdSetback, 1200);
  assert.equal(migrated.villaParams.roofFenShui, 4.5);
  assert.equal(migrated.villaParams.gutterBedSlope, DEFAULT_VILLA_PARAMS.gutterBedSlope);
  assert.deepEqual(migrated.courtyardDimLayout, { "v-setback": 1500 });
  // 显式 units="m" 同样迁移
  assert.equal(parseSizeVersionDocument({ ...meter, units: "m" }).villaParams.mainWidth, DEFAULT_VILLA_PARAMS.mainWidth);
  // 毫米稿原样
  assert.equal(parseSizeVersionDocument(mm).villaParams.mainWidth, DEFAULT_VILLA_PARAMS.mainWidth);
});

test("旧米制户型版本读回迁成毫米，旋转角与踏步数不被放大", () => {
  const draft = clonePublishedLayout();
  const mm = JSON.parse(layoutDocToJson(buildLayoutVersionDocument(draft, { title: "户型-旧", id: "户型-旧" }))) as Record<string, unknown>;
  const meter: Record<string, unknown> = { ...mm, layoutDraft: toMetersDeep(mm.layoutDraft) };
  delete meter.units;
  const rawFloor0 = ((meter.layoutDraft as { floors: { height: number }[] }).floors[0])!;
  assert.equal(rawFloor0.height, 3.6);
  const migrated = parseLayoutVersionDocument(meter);
  assert.equal(migrated.units, LENGTH_UNITS);
  assert.equal(migrated.layoutDraft.floors[0]!.height, 3600);
  assert.equal(migrated.layoutDraft.floors[0]!.rooms[0]!.w, draft.floors[0]!.rooms[0]!.w);
  assert.equal(migrated.layoutDraft.stairLayout.risers, draft.stairLayout.risers);
  assert.ok(Math.abs(migrated.layoutDraft.floors[0]!.partitions[0]!.a[0] - draft.floors[0]!.partitions[0]!.a[0]) < 1e-6);
  // 毫米稿不被再放大
  assert.equal(parseLayoutVersionDocument(mm).layoutDraft.floors[0]!.height, 3600);
});
