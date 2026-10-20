import test from "node:test";
import assert from "node:assert/strict";
import { blankLayoutDraft, createLayoutVersion, layoutVersionName, renameLayoutVersion, suggestLayoutVersionName } from "../src/layout-version-management";
import { buildLayoutVersionDocument, emptyDataIndex, parseLayoutVersionDocument, prependVersionMeta, persistDataVersion, deleteDataVersion, loadDataVersionsIndex, loadLayoutVersion } from "../src/data-versions";
import { clonePublishedLayout } from "../src/layout-draft";

const now = new Date(2026, 9, 20, 12, 0, 0);
function fixture() {
  const document = createLayoutVersion(clonePublishedLayout(), "原版本", emptyDataIndex("户型"), now);
  const file = `${document.id}.json`;
  const index = prependVersionMeta(emptyDataIndex("户型"), { id: document.id, title: document.title, file, savedAt: document.savedAt });
  return { document, index, file };
}

test("新增为空白三层及辅楼，保留外壳、门窗与层高，不污染当前稿；可保存回读", () => {
  const source = clonePublishedLayout();
  const before = structuredClone(source);
  const blank = blankLayoutDraft(source);
  assert.equal(blank.floors.length, 3);
  for (const [n, floor] of blank.floors.entries()) {
    assert.deepEqual([floor.rooms, floor.partitions, floor.furniture], [[], [], []]);
    assert.equal(floor.height, source.floors[n]!.height);
    assert.equal(floor.front, source.floors[n]!.front);
  }
  assert.deepEqual([blank.annexRooms, blank.annexPartitions, blank.annexFurniture], [[], [], []]);
  assert.deepEqual(blank.envelope, source.envelope);
  assert.deepEqual(blank.exteriorOpenings, source.exteriorOpenings);
  const again = parseLayoutVersionDocument(buildLayoutVersionDocument(blank));
  assert.equal(again.layoutDraft.livingVoid.w, 0);
  assert.equal(again.layoutDraft.livingVoid.d, 0);
  assert.deepEqual(source, before);
});

test("复制完整当前稿，连续同秒创建也不覆盖；修改副本不影响原稿", () => {
  const { document, index } = fixture();
  document.layoutDraft.floors[0]!.rooms[0]!.name = "未保存的修改";
  const copy = createLayoutVersion(document.layoutDraft, "自定义名称 / 不作为文件名", index, now);
  assert.notEqual(copy.id, document.id);
  assert.equal(copy.id, `${document.id}-2`);
  assert.deepEqual(copy.layoutDraft, document.layoutDraft);
  copy.layoutDraft.floors[0]!.rooms[0]!.name = "副本修改";
  assert.equal(document.layoutDraft.floors[0]!.rooms[0]!.name, "未保存的修改");
  const next = prependVersionMeta(index, { id: copy.id, title: copy.title, file: `${copy.id}.json`, savedAt: copy.savedAt });
  assert.equal(createLayoutVersion(document.layoutDraft, "第三份", next, now).id, `${document.id}-3`);
});

test("重命名保留顺序、编号、时间及图纸，使用已保存文档且不污染原对象", () => {
  const { document, index, file } = fixture();
  const second = { ...index.versions[0]!, id: "另一个", file: "另一个.json" };
  index.versions.unshift(second);
  const original = structuredClone(document);
  const renamed = renameLayoutVersion(document, index, file, "  设计方案 A  ");
  assert.equal(renamed.document.title, "设计方案 A");
  assert.deepEqual({ ...renamed.document, title: original.title }, original);
  assert.equal(renamed.index.versions[0]!.file, second.file);
  assert.equal(renamed.index.versions[1]!.title, "设计方案 A");
  assert.equal(index.versions[1]!.title, "原版本");
  assert.deepEqual(document, original);
  assert.throws(() => renameLayoutVersion(document, emptyDataIndex("户型"), file, "失效"), /不存在/);
});

test("名称校验空白、换行、超长；建议名避开重复", () => {
  const { index } = fixture();
  for (const name of ["  ", "换\n行", "x".repeat(81)]) assert.throws(() => layoutVersionName(name));
  assert.equal(layoutVersionName("  原版本  "), "原版本");
  assert.equal(suggestLayoutVersionName("原版本", index), "原版本（2）");
});

test("真实服务写入失败时保存和删除报错，不假装成功或触发下载", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("write failed", { status: 500 }));
  const { document, index, file } = fixture();
  await assert.rejects(persistDataVersion({ kind: "户型", document, index }), /保存.*失败/);
  await assert.rejects(deleteDataVersion({ kind: "户型", file, index }), /删除.*失败/);
});

test("静态服务下载后，本次页面内仍能切换、重命名和删除新版本", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("not found", { status: 404 }));
  const downloads: string[] = [];
  t.mock.method(URL, "createObjectURL", () => "blob:test");
  t.mock.method(globalThis, "setTimeout", (() => 0) as unknown as typeof setTimeout);
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    body: { append() {} },
    createElement() { return { download: "", click() { downloads.push(this.download); }, remove() {} }; },
  } });
  t.after(() => { if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument); else Reflect.deleteProperty(globalThis, "document"); });
  const { document, index, file } = fixture();
  assert.equal((await persistDataVersion({ kind: "户型", document, index })).via, "download");
  assert.equal((await loadLayoutVersion(file))!.title, document.title);
  assert.deepEqual(await loadDataVersionsIndex("户型"), index);
  const renamed = renameLayoutVersion((await loadLayoutVersion(file))!, index, file, "下载方案改名");
  await persistDataVersion({ kind: "户型", ...renamed });
  assert.equal((await loadLayoutVersion(file))!.title, "下载方案改名");
  await deleteDataVersion({ kind: "户型", file, index: emptyDataIndex("户型") });
  assert.equal((await loadDataVersionsIndex("户型")).versions.length, 0);
  assert.equal(await loadLayoutVersion(file), null);
  assert.equal(downloads.length, 3);
});
