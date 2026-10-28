import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { buildVilla, villaLayoutFacades, villaLayoutFromDraft } from "../src/architecture.ts";
import { buildEditorModel, disposeEditorModel } from "../src/editor-model.ts";
import { clonePublishedLayout } from "../src/layout-draft.ts";
import { elevationSvg } from "../src/elevation-plan.ts";
import { continuousGlazingGrid, continuousGlazing } from "../src/continuous-glazing.ts";
import { resolveLayoutFacades } from "../src/facade-layout.ts";
import { site } from "../src/data.ts";
import { alignedEntryOpenings, entryAssemblyDesign } from "../src/entry-assembly.ts";
import { LayoutEditor } from "../src/layout-editor.ts";
import { planSourceFromDraft } from "../src/plan.ts";
import { applyVillaParams, DEFAULT_VILLA_PARAMS, resetVillaParams } from "../src/villa-params.ts";
import type { Mats } from "../src/primitives.ts";

const context = new Proxy({ measureText: () => ({ width: 100 }) }, { get: (target, key) => Reflect.get(target, key) ?? (() => {}) });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) } as unknown as Document;
const materials = () => new Proxy({} as Mats, { get: (target, key: keyof Mats) => target[key] ??= new THREE.MeshPhysicalMaterial() as never });
const panes = (root: THREE.Object3D) => {
  const result: THREE.Mesh[] = [];
  root.traverse(o => { if (o instanceof THREE.Mesh && o.name === "通高玻璃分格板块") result.push(o); });
  return result;
};
const glassBounds = (root: THREE.Object3D) => {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  panes(root).forEach(pane => bounds.union(new THREE.Box3().setFromObject(pane)));
  return bounds;
};
const panelCount = (root: THREE.Object3D) => {
  let count = 0;
  root.traverse(o => { if (o.userData.continuousGlazing) count++; });
  return count;
};
function fixture() {
  const draft = clonePublishedLayout();
  const index = draft.exteriorOpenings.findIndex(o => o.floor === 0 && o.facadeIndex === 0 && o.opening.kind === "window");
  const source = draft.exteriorOpenings[index];
  source.opening.offset += 150; source.opening.width = 2500;
  return { draft, index, source };
}

test("编辑挑空客厅外窗后生成独立分格玻璃，按宽高安排固定窗及开启扇且不封墙", () => {
  const { draft, source } = fixture(), before = structuredClone(draft), mat = materials();
  const layout = villaLayoutFromDraft(draft), villa = buildVilla(mat, false, site.roofFenShui, "joined", layout);
  const glass = panes(villa.group);
  assert.ok(glass.length > 1);
  assert.equal(panelCount(villa.group), 1);
  villa.group.updateMatrixWorld(true);
  const bounds = glassBounds(villa.group);
  assert.equal(Math.round(bounds.max.x - bounds.min.x), source.opening.width - 146);
  assert.ok(Math.abs((bounds.min.x + bounds.max.x) / 2 - (site.main.x + source.opening.offset + source.opening.width / 2)) < 1);
  assert.ok(bounds.min.y < draft.floors[1].y && bounds.max.y > draft.floors[1].y + 2000);
  const ray = new THREE.Raycaster(new THREE.Vector3((bounds.min.x + bounds.max.x) / 2, draft.floors[1].y, site.main.z - 500), new THREE.Vector3(0, 0, 1), 0, 1000);
  assert.equal(ray.intersectObject(villa.group, true).filter(hit => (hit.object as THREE.Mesh).material === mat.sand).length, 0, "层间不能封墙");
  assert.ok(villa.group.getObjectByName("通高玻璃横梃"));
  assert.equal(panes(villa.group).length, 9);
  for (const floor of [0, 1]) assert.ok(villaLayoutFacades(floor, layout)[0].openings.some(o => o.continuous));
  assert.deepEqual(draft, before);
});

test("取消挑空恢复普通逐层外窗，保留其他房间与辅楼的洞口参数", () => {
  const { draft } = fixture();
  draft.livingVoid.w = draft.livingVoid.d = 0;
  draft.floors.forEach(f => { f.rooms = f.rooms.filter(r => r.kind !== "void"); });
  const layout = villaLayoutFromDraft(draft);
  assert.equal(panes(buildVilla(materials(), false, site.roofFenShui, "joined", layout).group).length, 0);
  assert.ok(villaLayoutFacades(0, layout)[0].openings.filter(o => !o.door).every(o => !o.continuous && !o.span));
  for (const item of draft.exteriorOpenings.filter(o => o.floor === 3 || o.floor === 2)) {
    const openings = villaLayoutFacades(item.floor, layout)[item.facadeIndex].openings;
    assert.ok(openings.some(o => Math.abs(o.w - item.opening.width) < 1 && Math.abs(o.at - o.w / 2 - item.opening.offset) < 1 && !o.continuous));
  }
});

test("挑空移到侧面时跟随实际外墙识别；离开外墙或退台不强行合并", () => {
  const { draft } = fixture();
  draft.livingVoid = { x: site.main.x + site.main.w - 3000, z: site.main.z + 3000, w: 3000, d: 4000 };
  draft.floors[1].rooms = draft.floors[1].rooms.filter(r => r.kind !== "void");
  for (const floor of [0, 1]) draft.exteriorOpenings.push({ floor, facadeIndex: 3, opening: { kind: "window", offset: 3500, width: 1800 } });
  let walls = villaLayoutFacades(0, villaLayoutFromDraft(draft));
  assert.ok(walls[3].openings.some(o => o.continuous));
  assert.ok(walls[0].openings.every(o => !o.continuous));
  draft.livingVoid.x -= 2000;
  walls = villaLayoutFacades(0, villaLayoutFromDraft(draft));
  assert.ok(walls.every(f => f.openings.every(o => !o.continuous)));
  draft.livingVoid.x += 2000;
  draft.exteriorOpenings.push({ floor: 1, facadeIndex: 3, opening: { kind: "door", offset: 3500, width: 900 } });
  assert.ok(villaLayoutFacades(0, villaLayoutFromDraft(draft))[3].openings.every(o => !o.continuous), "上层真实门洞不能被通高窗覆盖");
});

test("编辑全高模型和楼层分离只生成一组分格通高窗，保留外窗选择身份；剖切按高度裁剪", () => {
  const { draft, index } = fixture(), before = structuredClone(draft);
  for (const floors of [undefined, [0], [1]]) for (const cut of [1200, "full"] as const) {
    const model = buildEditorModel(draft, materials(), cut, { floors });
    const glass = panes(model.root); assert.ok(glass.length > 1);
    assert.equal(panelCount(model.root), 1);
    model.root.updateMatrixWorld(true);
    const bounds = glassBounds(model.root);
    if (cut === "full") assert.ok(bounds.min.y < draft.floors[1].y && bounds.max.y > draft.floors[1].y + 2000);
    else assert.ok(bounds.max.y <= (floors?.[0] === 1 ? draft.floors[1].y : site.entranceRise) + 1200);
    const owner = glass[0].parent!;
    assert.deepEqual(owner.userData.layoutSelection, { kind: "door", floor: 0, index, exterior: true });
    disposeEditorModel(model.root, new THREE.Scene());
  }
  assert.deepEqual(draft, before);
});

test("通高玻璃随外窗改宽增量更新，其他楼层和普通外窗不受影响", () => {
  const { draft, source } = fixture(), mat = materials();
  const initial = buildVilla(mat, false, site.roofFenShui, "joined", villaLayoutFromDraft(draft));
  source.opening.width = 2800;
  const next = buildVilla(mat, false, site.roofFenShui, "joined", villaLayoutFromDraft(draft), initial);
  assert.equal(panelCount(next.group), 1);
  assert.ok(panes(next.group).length > 1);
  assert.equal(Math.round(glassBounds(next.group).getSize(new THREE.Vector3()).x), 2654);
  assert.equal(next.levels[2], initial.levels[2]);
  assert.equal(next.annex, initial.annex);
});

test("立面图共用通高窗分格，保留整体窗尺寸和开启窗", () => {
  const { draft } = fixture();
  const svg = elevationSvg("north", "joined", villaLayoutFromDraft(draft));
  assert.equal((svg.match(/挑空客厅通高玻璃 · 2500×/g) ?? []).length, 1);
  assert.ok((svg.match(/data-glazing-pane="1"/g) ?? []).length > 1);
  assert.match(svg, /下方可开启窗/);
  assert.doesNotMatch(elevationSvg("south", "joined", villaLayoutFromDraft(draft)), /挑空客厅通高玻璃/);
});

test("通高窗窄洞单列、常规三列中宽、超宽增加固定列；框玻璃无重叠且剖切不重排", () => {
  const { draft } = fixture(), panel = resolveLayoutFacades(draft).glazing[0];
  for (const width of [600, 2500, 3800, 5200]) {
    const p = { ...panel, w: width }, grid = continuousGlazingGrid(p);
    const columns = width === 600 ? 1 : width === 2500 ? 3 : width === 3800 ? 4 : 5;
    assert.equal(new Set(grid.panes.map(p => p.column)).size, columns);
    assert.equal(grid.windows.length, width === 600 ? 1 : 2);
    assert.deepEqual(grid.panes.filter(p => p.operable).map(p => [p.row, p.column]), width === 600 ? [[0, 0]] : [[0, 0], [0, columns - 1]]);
    const middle = grid.panes.filter(p => p.row === 1);
    if (width === 2500) {
      assert.ok(Math.abs((middle[1].w + 6) / (middle[0].w + 6) - 1.5) < 1e-6);
      assert.ok(Math.abs(middle[0].w - middle[2].w) < 1e-6);
    }
    assert.ok(grid.windows.every(w => w.w >= 350 && w.w <= 850 && w.h <= 1500), "开启扇不能被拉成窄条或整层超高扇");
    for (const [i, a] of grid.frames.entries()) for (const b of grid.frames.slice(i + 1))
      assert.ok(Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) < 1e-6 || Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) < 1e-6);
    for (const glass of grid.panes) {
      assert.ok(glass.w > 0 && glass.h > 0);
      for (const f of grid.frames) assert.ok(Math.min(glass.x + glass.w, f.x + f.w) <= Math.max(glass.x, f.x) || Math.min(glass.y + glass.h, f.y + f.h) <= Math.max(glass.y, f.y));
    }
    const splitY = draft.floors[1].y;
    const model = continuousGlazing(new THREE.Group(), p, new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial(), splitY, splitY + 1200);
    const expected = grid.panes.filter(r => r.y < splitY + 1200 && r.y + r.h > splitY);
    assert.equal(panes(model).length, expected.length);
    panes(model).forEach((mesh, i) => {
      const size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
      assert.ok(Math.abs(size.x - expected[i].w) < 1);
      assert.ok(size.y <= 1200);
    });
  }
});

test("门厅大门、中段装饰板和二楼窗同宽，上窗用按尺寸分片的固定玻璃替代密花格", () => {
  const villa = buildVilla(materials(), false, site.roofFenShui, "joined");
  villa.group.updateMatrixWorld(true);
  const widthOf = (name: string) => {
    const object = villa.group.getObjectByName(name);
    assert.ok(object, `缺少 ${name}`);
    const bounds = new THREE.Box3().setFromObject(object!);
    return bounds.max.x - bounds.min.x;
  };
  const expected = widthOf("门厅中段棕色斜纹");
  assert.ok(Math.abs(widthOf("铸铝咖色大门") - expected) < 25, "大门应与中段装饰同宽");
  assert.ok(Math.abs(widthOf("门厅二楼门头玻璃") + 6 - expected) < 1, "上部玻璃两侧各留3毫米安装槽");
  let horizontal = 0, vertical = 0;
  villa.group.traverse(object => {
    if (object.name === "门厅上窗横梃") horizontal++;
    if (object.name === "门厅上窗竖梃") vertical++;
  });
  assert.equal(horizontal, 0);
  assert.equal(vertical, 2);
  assert.ok(!villa.group.getObjectByName("门厅玻璃回字花格"));
});

test("旧稿窄入口窗按大门对齐，修改其他前窗不取消通高门，二维立体与立面共用宽度且不改源稿", () => {
  const { draft } = fixture();
  const door = draft.exteriorOpenings.find(o => o.floor === 0 && o.facadeIndex === 0 && o.opening.kind === "doubleDoor")!;
  const upper = draft.exteriorOpenings.find(o => o.floor === 1 && o.facadeIndex === 0 && Math.abs(o.opening.offset + o.opening.width / 2 - door.opening.offset - door.opening.width / 2) < 100)!;
  upper.opening.width = 1500; upper.opening.offset = door.opening.offset + door.opening.width / 2 - 735;
  const before = structuredClone(draft), entry = resolveLayoutFacades(draft).entries[0];
  assert.ok(entry); assert.equal(entry.w, door.opening.width);
  const source = planSourceFromDraft(draft, 1).exteriorOpenings[draft.exteriorOpenings.indexOf(upper)];
  assert.equal(source.opening.width, door.opening.width); assert.equal(source.opening.offset, door.opening.offset);
  const parts = entryAssemblyDesign(entry), core = parts.filter(p => ["door", "panel"].includes(p.role)), glass = parts.filter(p => p.role === "glass");
  assert.equal(core.length, 2); assert.ok(core.every(p => p.x === core[0].x && p.w === core[0].w));
  assert.equal(core[0].y + core[0].h, core[1].y);
  assert.equal(Math.min(...glass.map(p => p.y)), core[1].y + core[1].h + 3);
  assert.equal(Math.min(...glass.map(p => p.x)), core[0].x + 3);
  assert.ok(Math.abs(Math.max(...glass.map(p => p.x + p.w)) - core[0].x - core[0].w + 3) < .001);
  const mat = materials(), villa = buildVilla(mat, false, site.roofFenShui, "joined", villaLayoutFromDraft(draft));
  villa.group.updateMatrixWorld(true);
  const panel = villa.group.getObjectByName("门厅中段棕色斜纹")!;
  const bounds = new THREE.Box3().setFromObject(panel), center = bounds.getCenter(new THREE.Vector3());
  const ray = new THREE.Raycaster(new THREE.Vector3(center.x, draft.floors[1].y, bounds.min.z - 100), new THREE.Vector3(0, 0, 1), 0, 180);
  assert.equal(ray.intersectObject(villa.group, true)[0]?.object, panel, "层间装饰板不能被白墙或板边截断");
  const svg = elevationSvg("north", "joined", villaLayoutFromDraft(draft));
  assert.match(svg, /一门到顶门窗/); assert.equal((svg.match(/data-entry-part="glass"/g) ?? []).length, glass.length);
  assert.doesNotMatch(elevationSvg("south", "joined", villaLayoutFromDraft(draft)), /一门到顶门窗/);
  assert.deepEqual(draft, before);
  const deleted = structuredClone(draft); deleted.exteriorOpenings.splice(draft.exteriorOpenings.indexOf(upper), 1);
  assert.equal(resolveLayoutFacades(deleted).entries.length, 0, "删除上窗后不能强行补回洞口");
});

test("编辑任一层入口宽度与位置双向同步，可撤销恢复，普通窗不受影响", () => {
  const draft = clonePublishedLayout(), lower = draft.exteriorOpenings.findIndex(o => o.floor === 0 && o.facadeIndex === 0 && o.opening.kind === "doubleDoor");
  const center = draft.exteriorOpenings[lower].opening.offset + draft.exteriorOpenings[lower].opening.width / 2;
  const upper = draft.exteriorOpenings.findIndex(o => o.floor === 1 && o.facadeIndex === 0 && Math.abs(o.opening.offset + o.opening.width / 2 - center) < 100);
  const editor = new LayoutEditor({ getFloor: () => 1, redraw: () => {}, toast: () => {} } as never, draft);
  const unrelated = structuredClone(editor.draft.exteriorOpenings.filter((_, i) => i !== lower && i !== upper));
  editor.selection = { kind: "door", floor: 1, exterior: true, index: upper };
  editor.updateSelectedNumber("width", 2800);
  assert.equal(editor.draft.exteriorOpenings[lower].opening.width, 2800);
  assert.equal(editor.draft.exteriorOpenings[upper].opening.width, 2800);
  editor.updateSelectedNumber("offset", editor.draft.exteriorOpenings[upper].opening.offset + 100);
  assert.equal(editor.draft.exteriorOpenings[lower].opening.offset, editor.draft.exteriorOpenings[upper].opening.offset);
  editor.undo(); editor.undo();
  assert.equal(editor.draft.exteriorOpenings[lower].opening.width, draft.exteriorOpenings[lower].opening.width);
  assert.deepEqual(editor.draft.exteriorOpenings.filter((_, i) => i !== lower && i !== upper), unrelated);
  assert.deepEqual(alignedEntryOpenings(editor.draft), editor.draft.exteriorOpenings);
});

test("通高门跟随凸凹门厅、主辅楼位置和尺寸；全高分离不重复，剖切保留整门并裁上窗", () => {
  try {
    for (const buildingPlacement of ["main-east", "main-west"] as const) for (const porticoStyle of ["projecting", "recessed"] as const) {
      applyVillaParams({ ...DEFAULT_VILLA_PARAMS, buildingPlacement, porticoStyle, mainWidth: 14000 });
      const draft = clonePublishedLayout(), entry = resolveLayoutFacades(draft).entries[0];
      assert.ok(entry); assert.ok(entry.w > 0);
      const worldX = entry.a[0] + (entry.b[0] - entry.a[0]) * entry.at / Math.hypot(entry.b[0] - entry.a[0], entry.b[1] - entry.a[1]);
      assert.ok(worldX > site.portico.x && worldX < site.portico.x + site.portico.w);
      assert.ok(Math.abs(entry.a[1] - site.main.z - 120 - (porticoStyle === "recessed" ? site.portico.projection : 0)) < 1);
      for (const floors of [undefined, [0], [1]]) for (const cut of ["full", 1200] as const) {
        const model = buildEditorModel(draft, materials(), cut, { floors });
        const entries: THREE.Object3D[] = []; model.root.traverse(o => { if (o.userData.entryAssembly) entries.push(o); });
        assert.equal(entries.length, 1);
        const bounds = new THREE.Box3().setFromObject(entries[0]);
        if (cut === "full") { assert.ok(Math.abs(bounds.min.y - entry.bottom) < 1); assert.ok(Math.abs(bounds.max.y - entry.top) < 1); }
        else {
          const expectedTop = floors?.[0] === 1 ? draft.floors[1].y + 1200 : Math.max(entry.bottom + 1200, entry.bandBottom + 40);
          assert.ok(Math.abs(bounds.max.y - expectedTop) < 1, "下层门扇及门顶横框完整，上层玻璃仍按1200剖切");
        }
        disposeEditorModel(model.root, new THREE.Scene());
      }
    }
  } finally { resetVillaParams(); }
});
