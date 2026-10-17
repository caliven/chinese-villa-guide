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
