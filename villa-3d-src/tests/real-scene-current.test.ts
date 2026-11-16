import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyScheme } from "../src/scheme-store.ts";
import { clonePublishedLayout } from "../src/layout-draft.ts";
import { buildLayoutVersionDocument } from "../src/data-versions.ts";
import { loadRealSceneScheme } from "../src/real-scene-scheme.ts";

test("三层实景刷新保留当前稿独立户型，缺少当前稿户型时再使用默认版本", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const current = createEmptyScheme();
  current.layoutDraft = clonePublishedLayout();
  current.layoutDraft.floors[0].rooms[0].name = "已保存当前稿独立编辑";
  const version = buildLayoutVersionDocument(clonePublishedLayout(), { id: "default-layout" });
  const defaultName = version.layoutDraft.floors[0].rooms[0].name;
  globalThis.fetch = (async url => {
    const pathname = decodeURI(new URL(String(url)).pathname);
    if (pathname.endsWith("/current.json")) return Response.json(current);
    if (pathname.endsWith("/index.json")) return Response.json({
      schema: "anhua-villa-data-versions-v1", kind: "户型",
      versions: [{ id: version.id, title: version.title, file: "default-layout.json", savedAt: version.savedAt }],
    });
    if (pathname.endsWith("/default-layout.json")) return Response.json(version);
    throw new Error(`意外读取 ${pathname}`);
  }) as typeof fetch;
  const base = new URL("http://localhost/villa-3d/");
  assert.equal((await loadRealSceneScheme(base)).layoutDraft!.floors[0].rooms[0].name, "已保存当前稿独立编辑");
  current.layoutDraft = null;
  assert.equal((await loadRealSceneScheme(base)).layoutDraft!.floors[0].rooms[0].name, defaultName);
});
