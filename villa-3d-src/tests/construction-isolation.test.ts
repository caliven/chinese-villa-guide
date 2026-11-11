import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { schemeSavePlugin } from "../vite-plugin-scheme-save.ts";
import { dataSavePlugin } from "../vite-plugin-data-save.ts";
import { createEmptyScheme, parseSchemeDocument } from "../src/scheme-store.ts";
import { assertConstructionScope, dataDirectory, schemeDirectory, schemeStorageKey } from "../src/construction-scheme.ts";
import { halfStoreyDefaults } from "../src/half-storey.ts";

test("三层沿用旧路径，两层半的文件、默认户型和会议存储使用独立命名空间", () => {
  assert.equal(schemeDirectory("three-storey"), "scheme");
  assert.equal(dataDirectory("three-storey"), "data");
  assert.equal(schemeDirectory("two-and-half"), "scheme/two-and-half");
  assert.equal(dataDirectory("two-and-half"), "data/two-and-half");
  for (const key of ["anhua-villa-default-layout-v1", "anhua-villa-design-meeting-v1"])
    assert.notEqual(schemeStorageKey(key, "three-storey"), schemeStorageKey(key, "two-and-half"));
  assert.doesNotThrow(() => assertConstructionScope({}, "three-storey"));
  assert.throws(() => assertConstructionScope({}, "two-and-half"));
  assert.throws(() => assertConstructionScope({ constructionScheme: "two-and-half" }, "three-storey"));
});

test("服务端按文件身份转换旧半层层高，三层文件保留原有层高和退台", () => {
  const three = createEmptyScheme();
  assert.deepEqual(parseSchemeDocument(three, "three-storey").villaParams, three.villaParams);
  const raw = { ...three, constructionScheme: "two-and-half", villaParams: {
    ...three.villaParams, floor1Height: 3750, floor2Height: 3000, floor3Height: 3000,
  } };
  const half = parseSchemeDocument(raw, "two-and-half");
  assert.equal(half.villaParams.floor1Height, 3300);
  assert.equal(half.villaParams.floor3Height, 300);
  assert.equal(half.villaParams.thirdFloorMode, "flush");
  assert.equal(half.villaParams.thirdSetback, 0);
  assert.deepEqual(parseSchemeDocument(half, "two-and-half").villaParams, half.villaParams);
});

function middlewareOf(plugin: ReturnType<typeof dataSavePlugin>) {
  const handlers: Function[] = [];
  (plugin.configureServer as Function)({ middlewares: { use(fn: Function) { handlers.push(fn); } } });
  return async (url: string, body: unknown) => {
    const req = Object.assign(Readable.from([JSON.stringify(body)]), { url, method: "POST" });
    let payload = "";
    const res = { statusCode: 0, setHeader() {}, end(value: string) { payload = value; } };
    await handlers[0](req, res, () => assert.fail("不应跳过保存接口"));
    return { status: res.statusCode, body: JSON.parse(payload) };
  };
}

test("两层半保存当前稿和版本只写自身目录，错误方案身份在写入前拒绝", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "villa-construction-scheme-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "versions"));
  await writeFile(path.join(root, "current.json"), "三层当前稿");
  await writeFile(path.join(root, "versions/index.json"), "三层索引");
  const request = middlewareOf(schemeSavePlugin(root));
  const base = createEmptyScheme();
  const document = { ...base, constructionScheme: "two-and-half", id: "同名版本", villaParams: halfStoreyDefaults(base.villaParams) };
  const index = { schema: "anhua-villa-scheme-versions-v1", versions: [{ id: document.id, file: `${document.id}.json`, title: document.title, savedAt: document.savedAt }] };
  assert.equal((await request("/__scheme_save", { constructionScheme: "two-and-half", kind: "version", document, index })).status, 200);
  assert.equal(JSON.parse(await readFile(path.join(root, "two-and-half/current.json"), "utf8")).constructionScheme, "two-and-half");
  const before = await readFile(path.join(root, "two-and-half/versions/同名版本.json"), "utf8");
  assert.equal((await request("/__scheme_save", { constructionScheme: "three-storey", kind: "current", document })).status, 400);
  assert.equal((await request("/__scheme_save", { constructionScheme: "two-and-half", kind: "current", document: base })).status, 400);
  assert.equal((await request("/__scheme_save", { constructionScheme: "../bad", kind: "current", document })).status, 400);
  assert.equal(await readFile(path.join(root, "two-and-half/versions/同名版本.json"), "utf8"), before);
  assert.equal(await readFile(path.join(root, "current.json"), "utf8"), "三层当前稿");
  assert.equal(await readFile(path.join(root, "versions/index.json"), "utf8"), "三层索引");
});

test("两套方案可保存同名尺寸和户型，两层半删除版本不影响三层文件或索引", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "villa-construction-data-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const request = middlewareOf(dataSavePlugin(root));
  for (const kind of ["尺寸", "户型"]) {
    for (const constructionScheme of ["three-storey", "two-and-half"]) {
      const index = { schema: "anhua-villa-data-versions-v1", kind, versions: [{ id: "同名", file: "同名.json", title: constructionScheme }] };
      const document = { id: "同名", title: constructionScheme, constructionScheme };
      assert.equal((await request("/__data_save", { kind, constructionScheme, document, index })).status, 200);
    }
    const threeFile = path.join(root, kind, "同名.json"), threeIndex = path.join(root, kind, "index.json");
    const original = await readFile(threeFile, "utf8"), originalIndex = await readFile(threeIndex, "utf8");
    assert.equal((await request("/__data_delete", { kind, constructionScheme: "two-and-half", file: "同名.json", index: { schema: "anhua-villa-data-versions-v1", kind, versions: [] } })).status, 200);
    await assert.rejects(readFile(path.join(root, "two-and-half", kind, "同名.json")));
    assert.equal(await readFile(threeFile, "utf8"), original);
    assert.equal(await readFile(threeIndex, "utf8"), originalIndex);
    assert.equal((await request("/__data_save", { kind, constructionScheme: "two-and-half", document: { id: "同名", constructionScheme: "three-storey" } })).status, 400);
    assert.equal((await request("/__data_delete", { kind, constructionScheme: "invalid", file: "同名.json" })).status, 400);
  }
});
