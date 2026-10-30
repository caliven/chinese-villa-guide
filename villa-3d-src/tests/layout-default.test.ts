import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { getDefaultLayoutVersionFile, loadInitialLayoutVersion, setDefaultLayoutVersion } from "../src/layout-default";
import { buildLayoutVersionDocument, emptyDataIndex, prependVersionMeta, removeVersionMeta } from "../src/data-versions";
import { clonePublishedLayout } from "../src/layout-draft";
import { renameLayoutVersion } from "../src/layout-version-management";

function fixture(t: TestContext) {
  const values = new Map<string, string>();
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  } });
  t.after(() => {
    if (oldStorage) Object.defineProperty(globalThis, "localStorage", oldStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  const document = buildLayoutVersionDocument(clonePublishedLayout(), { id: "original", title: "原户型" });
  const selected = { id: document.id, title: document.title, file: "original.json", savedAt: document.savedAt };
  const newest = { ...selected, id: "newest", file: "newest.json", title: "较新户型" };
  const index = { ...emptyDataIndex("户型"), versions: [newest, selected] };
  return { values, index, document, selected, newest };
}

test("未设默认时保持首项加载；设置后按引用恢复完整三层配置，不改变版本顺序或内容", async t => {
  const { values, index, document, selected, newest } = fixture(t);
  const before = structuredClone(index);
  const calls: string[] = [];
  const loader = async (file: string) => { calls.push(file); return document; };
  assert.equal(getDefaultLayoutVersionFile(index), "");
  assert.equal((await loadInitialLayoutVersion(index, loader))?.file, newest.file);
  setDefaultLayoutVersion(index, selected.file);
  assert.equal((await loadInitialLayoutVersion(index, loader))?.file, selected.file);
  assert.deepEqual(calls, [newest.file, selected.file]);
  assert.equal((await loadInitialLayoutVersion(index, loader))?.document.layoutDraft.floors.length, 3);
  assert.deepEqual([...values.values()], [selected.file]);
  assert.deepEqual(index, before);
});

test("保存其他版本、插入新版本、重命名默认版本均保留默认引用；删除后回退首项", async t => {
  const { index, document, selected, newest } = fixture(t);
  setDefaultLayoutVersion(index, selected.file);
  const added = prependVersionMeta(index, { ...newest, id: "copy", file: "copy.json" });
  assert.equal(getDefaultLayoutVersionFile(added), selected.file);
  const renamed = renameLayoutVersion(document, added, selected.file, "新的名称");
  assert.equal(getDefaultLayoutVersionFile(renamed.index), selected.file);
  const deleted = removeVersionMeta(renamed.index, selected.file);
  assert.equal(getDefaultLayoutVersionFile(deleted), "");
  assert.equal((await loadInitialLayoutVersion(deleted, async () => document))?.file, "copy.json");
});

test("默认文件缺失、损坏或读取异常时回退首项；全部不可用保留当前方案，空目录不读取", async t => {
  const { index, document, selected, newest } = fixture(t);
  setDefaultLayoutVersion(index, selected.file);
  for (const fail of [async () => null, async () => { throw new Error("JSON损坏"); }]) {
    const calls: string[] = [];
    const result = await loadInitialLayoutVersion(index, async file => {
      calls.push(file);
      return file === selected.file ? fail() : document;
    });
    assert.equal(result?.file, newest.file);
    assert.deepEqual(calls, [selected.file, newest.file]);
  }
  assert.equal(await loadInitialLayoutVersion(index, async () => null), null);
  assert.equal(await loadInitialLayoutVersion(emptyDataIndex("户型"), async () => { assert.fail("空目录不应读取"); }), null);
});

test("草稿或不存在的版本不能设默认；存储禁用时启动可回退、设置明确报错且保留旧选择", async t => {
  const { index, document, selected, newest } = fixture(t);
  setDefaultLayoutVersion(index, selected.file);
  for (const file of ["", "missing.json"]) assert.throws(() => setDefaultLayoutVersion(index, file), /先保存/);
  t.mock.method(localStorage, "setItem", () => { throw new Error("禁用存储"); });
  assert.throws(() => setDefaultLayoutVersion(index, newest.file), /无法保存默认户型/);
  assert.equal(getDefaultLayoutVersionFile(index), selected.file);
  t.mock.method(localStorage, "getItem", () => { throw new Error("禁用存储"); });
  assert.equal(getDefaultLayoutVersionFile(index), "");
  assert.equal((await loadInitialLayoutVersion(index, async () => document))?.file, newest.file);
});
