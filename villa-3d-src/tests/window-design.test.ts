import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import * as THREE from "three";
import { windowDesign, moveWindowDesign, windowOpeningLine, type WindowRect, type WindowMode } from "../src/window-design.ts";
import { windowModel } from "../src/window-model.ts";
import { buildVilla, villaLayoutFromDraft } from "../src/architecture.ts";
import { buildEditorModel, disposeEditorModel } from "../src/editor-model.ts";
import { clonePublishedLayout } from "../src/layout-draft.ts";
import { parseLayoutVersionDocument } from "../src/data-versions.ts";
import { resolveLayoutFacades } from "../src/facade-layout.ts";
import { elevationSvg } from "../src/elevation-plan.ts";
import { site } from "../src/data.ts";
import type { Mats } from "../src/primitives.ts";

const context = new Proxy({ measureText: () => ({ width: 100 }) }, { get: (target, key) => Reflect.get(target, key) ?? (() => {}) });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) } as unknown as Document;
const materials = () => new Proxy({} as Mats, { get: (target, key: keyof Mats) => target[key] ??= new THREE.MeshPhysicalMaterial() as never });
const overlap = (a: WindowRect, b: WindowRect) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1e-6 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1e-6;
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < .01, `${a} != ${b}`);

test("普通小窗单扇、常规窗双扇、宽窗中间固定配两侧扇；型材不随整窗拉粗", () => {
  const small = windowDesign(600, 1500), normal = windowDesign(1500, 1500), wide = windowDesign(3000, 2700);
  assert.equal(small.windows.length, 1); assert.equal(normal.windows.length, 2); assert.equal(wide.windows.length, 2);
  assert.equal(wide.panes.filter(p => p.column === 1).length, 1, "宽高适合的中央固定玻璃不能再任意贴横杆");
  assert.ok(wide.windows.every(w => w.w > 600 && w.w < 700 && w.h < 1500));
  for (const grid of [small, normal, wide]) {
    assert.ok(grid.frames.filter(f => f.role === "边框").every(f => Math.min(f.w, f.h) === 60));
    assert.ok(grid.frames.filter(f => f.role === "开启扇框").every(f => Math.min(f.w, f.h) === 37));
  }
  const flat = windowDesign(600, 450).windows[0];
  assert.equal(flat.hinge, "top"); assert.equal(windowOpeningLine(flat)[1][1], flat.y);
});

test("1000及以下的窄窗仅一列一个开启扇，高窗上下固定玻璃不增加竖向分割", () => {
  for (const mode of ["standard", "continuous"] as const)
    for (const width of [600, 750, 900, 1000])
      for (const height of [1200, 1500, 1800, 2700, 5900]) {
        const grid = windowDesign(width, height, mode), label = `${mode} ${width}×${height}`;
        assert.equal(new Set(grid.panes.map(p => p.column)).size, 1, `${label} 不应分成两列细条`);
        assert.equal(grid.windows.length, 1, `${label} 只应有一扇可开启窗`);
        assert.equal(grid.frames.filter(f => f.role === "竖梃").length, 0, label);
        assert.ok(grid.windows[0].w <= 900 && grid.windows[0].h <= 1500, label);
      }
  assert.equal(windowDesign(1200, 1500).windows.length, 2, "常规宽窗继续采用双扇");
  assert.equal(windowDesign(1000, 1800, "fixed").windows.length, 0, "入口固定上窗不凭空增加开启功能");
});

test("全尺寸矩阵分格均为正尺寸、在洞内且互不穿插；活动扇不成为窄条或超高整片", () => {
  for (const mode of ["standard", "continuous", "fixed"] as WindowMode[])
    for (const width of [200, 600, 750, 1000, 1500, 1800, 2200, 3000, 3300, 3800, 5200])
      for (const height of [200, 450, 1200, 1500, 1800, 2500, 2700, 5900, 9000]) {
        const grid = windowDesign(width, height, mode), label = `${mode} ${width}×${height}`;
        for (const r of [...grid.frames, ...grid.panes]) {
          assert.ok([r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w > 0 && r.h > 0, label);
          assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= width + 1e-6 && r.y + r.h <= height + 1e-6, label);
        }
        grid.frames.forEach((a, i) => grid.frames.slice(i + 1).forEach(b => assert.ok(!overlap(a, b), `${label} 框料交叠`)));
        grid.panes.forEach((a, i) => {
          grid.panes.slice(i + 1).forEach(b => assert.ok(!overlap(a, b), `${label} 玻璃交叠`));
          grid.frames.forEach(b => assert.ok(!overlap(a, b), `${label} 玻璃穿框`));
          assert.ok(a.w <= 1500 && a.h <= 2700, `${label} 超大玻璃未分片`);
        });
        assert.ok(grid.windows.every(w => w.w >= 350 && w.w <= (width <= 1000 ? 900 : 850) && w.h <= 1500), label);
        if (mode === "fixed") assert.equal(grid.windows.length, 0);
      }
});

test("框扇接缝有密封条，玻璃压条封住安装槽；正反向射线均不穿空", () => {
  const mat = materials();
  for (const [width, height] of [[600, 1500], [1500, 1800], [3000, 2700]]) {
    const grid = windowDesign(width, height), model = windowModel(new THREE.Group(), grid, mat);
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model, true);
    close(bounds.min.x, 0); close(bounds.max.x, width); close(bounds.min.y, 0); close(bounds.max.y, height);
    const stations = [...grid.panes, ...grid.frames].flatMap(r => [[r.x + r.w / 2, r.y + r.h / 2], [r.x + .5, r.y + r.h / 2]]);
    for (const [x, y] of stations) for (const sign of [-1, 1]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(x, y, sign * 1000), new THREE.Vector3(0, 0, -sign));
      assert.ok(ray.intersectObject(model, true).length, `${width}×${height} ${x},${y} 存在透空缝`);
    }
    assert.ok(model.getObjectByName("玻璃压条")); assert.ok(model.getObjectByName("可开启窗执手"));
  }
});

test("剖切只裁完整窗原有构件，不重排分格或在切口补出假横框", () => {
  const mat = materials(), grid = moveWindowDesign(windowDesign(3000, 2700), 500, 900);
  const cut = windowModel(new THREE.Group(), grid, mat, { top: 1200 }); cut.updateMatrixWorld(true);
  const panes: THREE.Mesh[] = []; cut.traverse(o => { if (o instanceof THREE.Mesh && o.name === "窗分格玻璃") panes.push(o); });
  assert.equal(panes.length, grid.panes.filter(p => p.y < 1200).length);
  assert.equal(cut.children.filter(o => o.name === "窗横梃").length, 0);
  for (const pane of panes) {
    const bounds = new THREE.Box3().setFromObject(pane, true);
    close(bounds.max.y, 1200); assert.ok(bounds.min.y >= 963);
  }
});

test("全部保存户型直接载入新窗型，房屋与全高户型的窗规格一致，构建不改源稿", () => {
  const directory = new URL("../data/户型/", import.meta.url);
  for (const file of readdirSync(directory).filter(f => f !== "index.json" && f.endsWith(".json"))) {
    const { layoutDraft: draft } = parseLayoutVersionDocument(JSON.parse(readFileSync(new URL(file, directory), "utf8")));
    const before = JSON.stringify(draft), mat = materials();
    const villa = buildVilla(mat, false, site.roofFenShui, "joined", villaLayoutFromDraft(draft));
    const editor = buildEditorModel(draft, mat, "full");
    const dimensions = (root: THREE.Object3D) => {
      const values: string[] = []; root.traverse(o => { if (o.userData.windowDimensions) values.push(JSON.stringify(o.userData.windowDimensions)); });
      return values.sort();
    };
    assert.deepEqual(dimensions(villa.group), dimensions(editor.root), file);
    assert.ok(dimensions(villa.group).length > 10, `${file} 未更新已有窗口`);
    assert.equal(JSON.stringify(draft), before, file);
    disposeEditorModel(editor.root, new THREE.Scene());
  }
});

test("已放置普通窗改宽后增量重排，洞高不变，立面与三维使用同一分格", () => {
  const draft = clonePublishedLayout(), mat = materials(), resolved = resolveLayoutFacades(draft);
  const opening = resolved.facades[1].find(f => Math.abs(f.a[1] - site.main.z - site.main.d + 120) < 1 && f.a[1] === f.b[1])!.openings
    .find(o => !o.door && !o.continuous && !o.entryAssembly && o.layoutSourceIndex != null)!;
  const source = draft.exteriorOpenings[opening.layoutSourceIndex!];
  source.opening.height = 1500; source.opening.width = 1500;
  const initial = buildVilla(mat, false, site.roofFenShui, "joined", villaLayoutFromDraft(draft));
  source.opening.width = 2200;
  const changed = buildVilla(mat, false, site.roofFenShui, "joined", villaLayoutFromDraft(draft), initial);
  let newWindow: THREE.Object3D | undefined;
  changed.levels[1].traverse(o => { if (o.userData.windowDimensions?.width === 2200 && o.userData.windowDimensions.height === 1500) newWindow = o; });
  assert.ok(newWindow); assert.equal(source.opening.height, 1500);
  assert.equal(changed.levels[0], initial.levels[0]); assert.equal(changed.annex, initial.annex);
  const svg = elevationSvg("south", "joined", villaLayoutFromDraft(draft));
  assert.match(svg, /组合窗 · 2200×1500/); assert.match(svg, /data-window-frame="开启扇框"/); assert.match(svg, /可开启窗/);
});
