import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import * as THREE from "three";
import { parseLayoutVersionDocument } from "../src/data-versions.ts";
import { buildVilla, villaLayoutFromDraft } from "../src/architecture.ts";
import { buildEditorModel, disposeEditorModel } from "../src/editor-model.ts";
import { resolveLayoutFacades } from "../src/facade-layout.ts";
import { DEFAULT_DOOR_HEIGHT, createOpening, interiorOpeningProfile } from "../src/openings.ts";
import { site } from "../src/data.ts";
import { DEFAULT_VILLA_PARAMS, applyVillaParams, resetVillaParams } from "../src/villa-params.ts";
import type { Mats } from "../src/primitives.ts";

const context = new Proxy({ measureText: () => ({ width: 100 }) }, { get: (target, key) => Reflect.get(target, key) ?? (() => {}) });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) } as unknown as Document;
const doorSizes = (root: THREE.Object3D) => {
  const found: string[] = [];
  root.traverse(o => { const d = o.userData.doorDimensions; if (d) found.push(`${d.kind}:${d.height}`); });
  return found.sort();
};
test.afterEach(resetVillaParams);

test("全部保存户型的普通门统一高度，完整模型与户型三维一致", () => {
  const dir = new URL("../data/户型/", import.meta.url);
  const files = readdirSync(dir).filter(file => file !== "index.json" && file.endsWith(".json"));
  assert.ok(files.length > 0);
  for (const file of files) {
    const { layoutDraft: draft } = parseLayoutVersionDocument(JSON.parse(readFileSync(new URL(file, dir), "utf8")));
    const before = JSON.stringify(draft);
    const mat = new Proxy({} as Mats, { get(target, key: keyof Mats) { return target[key] ??= new THREE.MeshPhysicalMaterial() as never; } });
    const villa = buildVilla(mat, false, site.roofFenShui, "floating", villaLayoutFromDraft(draft));
    const editor = buildEditorModel(draft, mat, "full");
    const sizes = doorSizes(villa.group);
    assert.ok(sizes.length > 0, file);
    assert.ok(sizes.every(size => size.endsWith(`:${DEFAULT_DOOR_HEIGHT}`)), `${file}: ${sizes}`);
    assert.deepEqual(doorSizes(editor.root), sizes, file);
    assert.equal(JSON.stringify(draft), before);
    assert.ok(resolveLayoutFacades(draft).entries.length > 0, "门厅跨层组合保留独立结构");
    disposeEditorModel(editor.root, new THREE.Scene());
    Object.values(mat).forEach(material => material.dispose());
  }
});

test("普通门型使用相同默认洞高，净空不足时按实际墙高限制", () => {
  for (const kind of ["door", "bathroomDoor", "doubleDoor", "slidingDoor", "passage"] as const) {
    assert.equal(interiorOpeningProfile(createOpening(kind, 100), 3000).height, 2200);
    assert.equal(interiorOpeningProfile(createOpening(kind, 100), 2000).height, 1920);
  }
  applyVillaParams({ ...DEFAULT_VILLA_PARAMS, annexEyelidToFasciaGap: 750 });
  const door = resolveLayoutFacades().facades[3].flatMap(face => face.openings).find(o => o.door)!;
  assert.ok(door.h < 2200 && door.h > 0, "辅楼檐口不足时保留避让");
});
