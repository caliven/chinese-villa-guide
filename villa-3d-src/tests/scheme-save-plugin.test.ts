import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Readable } from "node:stream";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { schemeSavePlugin } from "../vite-plugin-scheme-save.ts";
import { createEmptyScheme } from "../src/scheme-store.ts";

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), "villa-scheme-save-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "versions"));
  await writeFile(path.join(root, "current.json"), "original-current\n");
  await writeFile(path.join(root, "versions", "index.json"), "original-index\n");
  let middleware: (req: unknown, res: unknown, next: () => void) => Promise<void>;
  const plugin = schemeSavePlugin(root);
  (plugin.configureServer as Function)({ middlewares: { use(handler: typeof middleware) { middleware = handler; } } });
  return { root, async request(body: unknown) {
    const request = Object.assign(Readable.from([JSON.stringify(body)]), { url: "/__scheme_save", method: "POST" });
    let payload = "";
    const response = { statusCode: 0, setHeader() {}, end(value: string) { payload = value; } };
    await middleware!(request, response, () => assert.fail("保存接口不应跳过"));
    return { status: response.statusCode, payload: JSON.parse(payload) };
  }, async unchanged() {
    assert.equal(await readFile(path.join(root, "current.json"), "utf8"), "original-current\n");
    assert.equal(await readFile(path.join(root, "versions", "index.json"), "utf8"), "original-index\n");
    assert.deepEqual((await readdir(root)).sort(), ["current.json", "versions"]);
    assert.deepEqual(await readdir(path.join(root, "versions")), ["index.json"]);
  } };
}

test("方案保存接口拒绝越出版本目录的编号和无效操作类型，原文件不变", async t => {
  const { request, unchanged } = await fixture(t);
  for (const id of ["../current", "../../outside", "..\\outside", "/tmp/outside", "index"]) {
    const document = { ...createEmptyScheme(), id };
    const result = await request({ kind: "version", document });
    assert.equal(result.status, 400, id);
    assert.equal(result.payload.ok, false);
    await unchanged();
  }
  assert.equal((await request({ kind: "wrong", document: createEmptyScheme() })).status, 400);
  await unchanged();
});

test("方案或附带当前稿缺失／格式错误时返回400，全部验证成功前不写任何文件", async t => {
  const { request, unchanged } = await fixture(t);
  const document = { ...createEmptyScheme(), id: "valid-version" };
  const index = { schema: "anhua-villa-scheme-versions-v1", versions: [{ id: document.id, file: `${document.id}.json`, title: document.title, savedAt: document.savedAt }] };
  for (const body of [
    null, {}, { kind: "current" }, { kind: "current", document: null }, { kind: "current", document: {} },
    { kind: "current", document: { schema: document.schema } },
    { kind: "current", document: { ...document, villaParams: { ...document.villaParams, mainWidth: -1 } } },
    { kind: "current", document: { ...document, layoutDraft: {} } },
    { kind: "version", document, index, current: {} },
    { kind: "version", document, index, current: { ...document, layoutDraft: {} } },
  ]) {
    const result = await request(body);
    assert.equal(result.status, 400, JSON.stringify(body));
    assert.equal(result.payload.ok, false);
    await unchanged();
  }
});

test("版本索引缺失、损坏或不含目标版本时拒绝整次保存", async t => {
  const { request, unchanged } = await fixture(t);
  const document = { ...createEmptyScheme(), id: "valid-version" };
  const meta = { id: document.id, file: `${document.id}.json`, title: document.title, savedAt: document.savedAt };
  for (const index of [
    undefined, null, {}, { schema: "wrong", versions: [meta] },
    { schema: "anhua-villa-scheme-versions-v1", versions: [] },
    { schema: "anhua-villa-scheme-versions-v1", versions: [null] },
    { schema: "anhua-villa-scheme-versions-v1", versions: [{ ...meta, file: "../outside.json" }] },
    { schema: "anhua-villa-scheme-versions-v1", versions: [{ ...meta, savedAt: "bad-date" }] },
    { schema: "anhua-villa-scheme-versions-v1", versions: [meta, meta] },
  ]) {
    const result = await request({ kind: "version", document, index });
    assert.equal(result.status, 400, JSON.stringify(index));
    assert.equal(result.payload.ok, false);
    await unchanged();
  }
});

test("有效方案及版本在隔离临时目录可保存并回读，不触碰项目数据", async t => {
  const { request, root } = await fixture(t);
  const document = createEmptyScheme();
  assert.equal((await request({ kind: "current", document })).status, 200);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, "current.json"), "utf8")), document);
  const version = { ...document, id: "version-1", title: "测试版本" };
  const index = { schema: "anhua-villa-scheme-versions-v1", versions: [{ id: version.id, file: `${version.id}.json`, title: version.title, savedAt: version.savedAt }] };
  assert.equal((await request({ kind: "version", document: version, index })).status, 200);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, "versions", "version-1.json"), "utf8")), version);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, "versions", "index.json"), "utf8")), index);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, "current.json"), "utf8")), { ...version, id: "current", title: "当前方案" });
});
