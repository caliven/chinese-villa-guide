import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { site, type Floor } from "../src/data";
import { applyVillaParams, DEFAULT_VILLA_PARAMS, resetVillaParams, getVillaParams } from "../src/villa-params";
import { clonePublishedLayout } from "../src/layout-draft";
import { livingVoidGuards, stairFloorGuards } from "../src/interior-guards";
import { canonicalRailingStyle, interiorRailing, railingStyleLabels, railingThickness, type RailingStyle } from "../src/railing-options";
import { railingModel } from "../src/railing-model";
import { stairs, type Mats } from "../src/primitives";
import { stairModelDefaults, stairOpeningBounds, stairShape } from "../src/stair-geometry";
import { parseSchemeDocument, createEmptyScheme } from "../src/scheme-store";
import { floorPlan, planSourceFromDraft } from "../src/plan";
import { villaParamsPanelHtml } from "../src/villa-params-ui";
import { buildVilla, villaLayoutFromDraft } from "../src/architecture";
import { buildEditorModel, disposeEditorModel } from "../src/editor-model";
import { recessedFloor } from "../src/building-variants";
import { resolveLayoutFacades } from "../src/facade-layout";
import { railingNetwork, type RailingSection } from "../src/railing-network";
import { stairRailingSections } from "../src/stair-railing";
import { interiorRailingLayout } from "../src/interior-railing";

test.afterEach(resetVillaParams);
const styles = [...Object.keys(railingStyleLabels), "brick"] as RailingStyle[];
function fixture() {
  const draft = clonePublishedLayout();
  const floor: Floor = { ...draft.floors[1], rooms: [], partitions: [], furniture: [] };
  const living = { x: site.main.x + 1500, z: floor.front + 1500, w: 3000, d: 3000 };
  return { draft, floor, living };
}
const mat = () => new Proxy({} as Mats, { get: (target, key: keyof Mats) => target[key] ??= new THREE.MeshPhysicalMaterial() as never });

test("四边临空自动围合，紧贴外墙的两边不生成；虚拟墙不遮挡栏杆", () => {
  const { floor, living } = fixture();
  for (const style of styles) assert.equal(livingVoidGuards(living, floor, [], style).length, 4);
  const attached = { ...living, x: site.main.x, z: floor.front };
  assert.equal(livingVoidGuards(attached, floor, [], "glass").length, 2);
  floor.partitions.push({ a: [living.x + living.w, living.z], b: [living.x + living.w, living.z + living.d], role: "virtual" });
  assert.equal(livingVoidGuards(living, floor, [], "glass").length, 4);
  floor.partitions[0].role = "partition";
  assert.equal(livingVoidGuards(living, floor, [], "glass").length, 3);
});

test("局部实体墙只遮挡对应一段，垂直相交墙两边留出柱身厚度", () => {
  const { floor, living } = fixture(), edge = living.x + living.w;
  floor.partitions.push({ a: [edge, living.z + 1000], b: [edge, living.z + 2000], role: "partition" });
  const rails = livingVoidGuards(living, floor, [], "glass");
  assert.equal(rails.length, 5);
  for (const [a, b] of rails.filter(([a, b]) => a[0] === b[0] && a[0] > edge))
    assert.ok(Math.max(a[1], b[1]) < living.z + 1000 || Math.min(a[1], b[1]) > living.z + 2000);
  floor.partitions = [{ a: [edge, living.z + 1500], b: [edge + 1000, living.z + 1500], role: "partition" }];
  assert.equal(livingVoidGuards(living, floor, [], "brick").length, 5);
});

test("手动栏杆按弧度旋转的真实占地避让；挑空改范围／删除即时派生", () => {
  const { floor, living } = fixture(), inset = railingThickness("glass") / 2 + 20;
  floor.furniture.push({ kind: "railing", x: living.x + living.w + inset, z: living.z + 1500, w: 3400, d: 180, rotation: Math.PI / 2 });
  assert.equal(livingVoidGuards(living, floor, [], "glass").length, 3);
  floor.furniture = [];
  const moved = livingVoidGuards({ ...living, x: living.x + 500, w: 4000 }, floor, [], "glass");
  assert.equal(moved.length, 4);
  assert.ok(moved.some(([a, b]) => a[0] === living.x + 4500 + inset && b[0] === a[0]));
  assert.deepEqual(livingVoidGuards({ ...living, w: 0, d: 0 }, floor, [], "glass"), []);
});

test("四种栏杆及旧砖柱选项在水平与正反斜段正确渲染，坐标有限", () => {
  for (const style of styles) for (const delta of [0, 1700, -1700]) {
    const root = new THREE.Group();
    const rail = railingModel(root, new THREE.Vector3(0, 2000, 0), new THREE.Vector3(2500, 2000 + delta, 0), style, 1100);
    const names = rail.children.map(child => child.name);
    assert.ok(names.includes(style === "glass" ? "独立玻璃片" : style === "brick" || style === "marble" ? "花瓶栏杆柱" : "竖向栏条"));
    assert.ok(!names.includes("砖砌墙身"));
    if (style === "glass") assert.ok(rail.children.some(child => child instanceof THREE.Mesh && (child.material as THREE.Material).transparent));
    const bounds = new THREE.Box3().setFromObject(rail);
    assert.ok(Math.abs(bounds.max.y - (Math.max(2000, 2000 + delta) + 1100)) < 1);
    rail.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      const positions = child.geometry.getAttribute("position");
      for (const value of positions.array) assert.ok(Number.isFinite(value));
    });
  }
});

test("两跑／三跑、双轴与反向楼梯均使用所选造型，踏步包络不改变", () => {
  const { draft } = fixture();
  for (const model of ["double", "triple"] as const) for (const axis of ["x", "z"] as const) for (const direction of ["positive", "negative"] as const) {
    const stair = { ...stairModelDefaults(draft.stairLayout, model, draft.floors), axis, direction };
    for (const style of styles) {
      interiorRailing.stair = style;
      const root = new THREE.Group(); stairs(root, stair.x, stair.z, 0, 3600, mat(), axis, stair);
      const rails = root.children.filter(child => child.userData.railingStyle);
      assert.ok(rails.length >= 3);
      assert.ok(rails.every(child => child.userData.railingStyle === canonicalRailingStyle(style)));
      const treads = root.children.filter(child => child instanceof THREE.Mesh);
      const bound = new THREE.Box3(); treads.forEach(child => bound.union(new THREE.Box3().setFromObject(child)));
      assert.ok(Math.abs(bound.max.y - (model === "triple" ? 3600 : 3600 * (stairShape(stair).risers - 1) / stairShape(stair).risers)) < 1);
      assert.ok(Math.abs(bound.min.x - stairShape(stair).footprint.x) < 1);
    }
  }
});

test("楼层洞口护栏不横封起步或到达通口，端头只接到两边梯段的内侧扶手", () => {
  const { draft, floor } = fixture();
  for (const model of ["double", "triple"] as const) for (const axis of ["x", "z"] as const) for (const direction of ["positive", "negative"] as const) for (const lowerSide of ["min", "max"] as const) {
    const stair = { ...stairModelDefaults(draft.stairLayout, model, draft.floors), x: site.main.x + 2500, z: floor.front + 2000, axis, direction, lowerSide };
    const g = stairShape(stair), hole = stairOpeningBounds({ ...stair, hole: g.footprint });
    stair.hole = hole;
    for (const style of styles) {
      const rails = stairFloorGuards(stair, floor, [], style);
      for (const cross of [g.lowerAcross, g.upperAcross]) {
        const entry = g.point(cross + stair.flight / 2, 0);
        for (const [a, b] of rails) {
          const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((entry.x - a[0]) * dx + (entry.z - a[1]) * dz) / (dx * dx + dz * dz)));
          const innerInset = Math.max(60, railingThickness(style) / 2 + 20);
          assert.ok(Math.hypot(entry.x - a[0] - t * dx, entry.z - a[1] - t * dz) > stair.flight / 2 - innerInset - 1,
            `${model}/${axis}/${direction}/${lowerSide}/${style}通口不能横放栏杆`);
        }
      }
      assert.ok(rails.some(([a, b]) => {
        const lo = g.local(a[0], a[1]), hi = g.local(b[0], b[1]);
        return lo.along < 0 && hi.along < 0 && Math.min(lo.across, hi.across) < g.across / 2
          && Math.max(lo.across, hi.across) > g.across / 2;
      }), "两通口之间的梯井临空边仍须有栏杆");
    }
  }
});

test("四种造型的水平及斜段圆弧转角共用一个实柱，接缝截面与法线完全一致", () => {
  for (const style of styles) for (const rise of [0, 900, -900]) {
    const corner = new THREE.Vector3(2000, rise, 0);
    const sections: RailingSection[] = [
      { a: new THREE.Vector3(), b: corner, height: 1100, style },
      // 第二段反向输入，验证不依赖线段排列方向。
      { a: new THREE.Vector3(2000, rise, 1800), b: corner, height: 1100, style },
    ];
    const network = railingNetwork(sections), root = new THREE.Group();
    const rails = network.render(root); root.updateMatrixWorld(true);
    const posts: THREE.Object3D[] = [];
    root.traverse(child => {
      if (!["主立柱", "大理石主柱"].includes(child.name)) return;
      const center = new THREE.Box3().setFromObject(child).getCenter(new THREE.Vector3());
      if (Math.hypot(center.x - corner.x, center.z - corner.z) < .1) posts.push(child);
    });
    assert.equal(posts.length, 1, `${style}/${rise}转角只保留一个真实主柱`);
    const seams = rails.map(rail => {
      const mesh = rail.getObjectByName(style === "marble" || style === "brick" ? "连续石材扶手" : "连续扶手") as THREE.Mesh;
      const position = mesh.geometry.getAttribute("position"), normal = mesh.geometry.getAttribute("normal");
      const points: { point: THREE.Vector3; normal: THREE.Vector3 }[] = [];
      const count = mesh.geometry.userData.handrailRingSize;
      const first = (mesh.geometry.userData.handrailRings - 1) * count;
      for (let i = first; i < first + count; i++) {
        const p = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
        const n = new THREE.Vector3().fromBufferAttribute(normal, i).transformDirection(mesh.matrixWorld);
        points.push({ point: p, normal: n });
      }
      return points;
    });
    assert.ok(seams[0].length >= 20, `${style}具有圆角截面`);
    for (const first of seams[0]) assert.ok(seams[1].some(second => first.point.distanceTo(second.point) < .002 && first.normal.distanceTo(second.normal) < .00001),
      `${style}/${rise}两侧扶手位置与光照法线连续（毫米局部坐标的Float32误差内）`);
    const first = network.handrails[0].at(-1)!, second = network.handrails[1].at(-1)!;
    assert.ok(first.tangent.dot(second.tangent) < -.99999, "反向输入的两侧在接头具有同一切线");
    assert.ok(first.point.distanceTo(corner.clone().setY(rise + 1100)) > 10, "扶手以圆弧绕过原硬折点");
  }
});

test("截图同规格三跑的70毫米短平台整体平滑，扶手细分面没有翻面或折叠", () => {
  const { draft } = fixture();
  const stair = { ...stairModelDefaults(draft.stairLayout, "triple", draft.floors), flight: 868, landing: 868, tread: 472, middleTread: 145 };
  for (const style of styles) {
    const sections = stairRailingSections(stair, 0, 3600, style), network = railingNetwork(sections);
    assert.ok(sections.some(s => s.a.distanceTo(s.b) < 100), "覆盖截图中的短平台");
    const rails = network.render(new THREE.Group());
    for (const [i, rail] of rails.entries()) {
      const mesh = rail.getObjectByName(style === "marble" || style === "brick" ? "连续石材扶手" : "连续扶手") as THREE.Mesh;
      const geometry = mesh.geometry, position = geometry.getAttribute("position"), normal = geometry.getAttribute("normal"), index = geometry.index!;
      const rings = geometry.userData.handrailRings, size = geometry.userData.handrailRingSize;
      for (let j = 0; j < (rings - 1) * size * 6; j += 3) {
        const ids = [index.getX(j), index.getX(j + 1), index.getX(j + 2)];
        const [a, b, c] = ids.map(id => new THREE.Vector3().fromBufferAttribute(position, id));
        const face = b.sub(a).cross(c.sub(a));
        const expected = ids.reduce((sum, id) => sum.add(new THREE.Vector3().fromBufferAttribute(normal, id)), new THREE.Vector3());
        assert.ok(face.dot(expected) > 0, `${style}/${i}扶手侧面不能扭转成反向三角面`);
      }
      const path = network.handrails[i];
      for (let j = 1; j < path.length; j++) assert.ok(path[j - 1].tangent.dot(path[j].tangent) > .97, "圆弧切线逐步变化");
    }
  }
});

test("双跑三跑的各方向平台只形成一条连续扶手路径，楼层栏杆与上下两层来梯接到同一节点", () => {
  const { draft, floor } = fixture();
  const floors = draft.floors.map(f => ({ ...f, rooms: [], partitions: [], furniture: [] }));
  for (const model of ["double", "triple"] as const) for (const axis of ["x", "z"] as const)
    for (const direction of ["positive", "negative"] as const) for (const lowerSide of ["min", "max"] as const) for (const style of styles) {
      const stair = { ...stairModelDefaults(draft.stairLayout, model, draft.floors), x: site.main.x + 2500, z: floor.front + 2500, axis, direction, lowerSide };
      stair.hole = stairShape(stair).footprint;
      const story = stairRailingSections(stair, 0, 3600, style), network = railingNetwork(story);
      assert.equal(network.joints.flatMap(joint => [joint.start, joint.end]).filter(Boolean).length, story.length * 2 - 2,
        `${model}/${axis}/${direction}/${lowerSide}/${style}中间平台不能断开`);
      interiorRailing.stair = style;
      const layout = interiorRailingLayout(floors, stair, { x: 0, z: 0, w: 0, d: 0 }, floors.map(() => []), true);
      for (const [storyIndex, floorIndex, start] of [[0, 1, false], [1, 1, true], [1, 2, false]] as const) {
        const index = layout.stories[storyIndex][start ? 0 : model === "triple" ? 2 : 1];
        const joint = start ? layout.joints[index].start : layout.joints[index].end;
        assert.ok(joint, `${model}/${axis}/${direction}/${lowerSide}/${style}梯段接住楼层栏杆`);
        assert.equal(joint.post, false, "层间交接柱由楼层栏杆持有，隐藏来梯不产生第二根柱子");
        const endpoint = start ? layout.sections[index].a : layout.sections[index].b;
        const owners = layout.stairGuards[floorIndex].flatMap(i => ([true, false] as const).flatMap(atStart => {
          const point = atStart ? layout.sections[i].a : layout.sections[i].b;
          return point.distanceTo(endpoint) < .1 && (atStart ? layout.joints[i].start : layout.joints[i].end)?.post ? [i] : [];
        }));
        assert.equal(owners.length, 1, "楼层交接点只有一个主柱持有者");
      }
    }
});

test("旧全局栏杆参数仍可回读，非法造型拒绝，尺寸面板不再提供栏杆选项", () => {
  const doc = createEmptyScheme();
  doc.villaParams.livingRailingStyle = "brick"; doc.villaParams.stairRailingStyle = "steel";
  const loaded = parseSchemeDocument(doc);
  assert.equal(loaded.villaParams.livingRailingStyle, "brick");
  assert.equal(loaded.villaParams.stairRailingStyle, "steel");
  applyVillaParams(loaded.villaParams);
  assert.deepEqual(interiorRailing, { living: "brick", stair: "steel" });
  assert.equal(getVillaParams().stairRailingStyle, "steel");
  const old = JSON.parse(JSON.stringify(doc));
  delete old.villaParams.livingRailingStyle; delete old.villaParams.stairRailingStyle;
  assert.equal(parseSchemeDocument(old).villaParams.livingRailingStyle, DEFAULT_VILLA_PARAMS.livingRailingStyle);
  old.villaParams.stairRailingStyle = "unknown";
  assert.throws(() => parseSchemeDocument(old), /栏杆/);
  const html = villaParamsPanelHtml(loaded.villaParams);
  assert.doesNotMatch(html, /data-railing-param|data-params-tab="railing"|室内栏杆/);
  doc.villaParams.stairRailingStyle = "marble";
  assert.equal(parseSchemeDocument(doc).villaParams.stairRailingStyle, "marble");
});

test("平面自动栏杆读取实际洞口且只出现在上层，删除洞口即消失", () => {
  const { draft, floor, living } = fixture();
  draft.floors[1] = floor; draft.livingVoid = living;
  assert.match(floorPlan(1, false, false, {}, planSourceFromDraft(draft, 1)), /data-auto-guard="living"/);
  assert.doesNotMatch(floorPlan(0, false, false, {}, planSourceFromDraft(draft, 0)), /data-auto-guard="living"/);
  draft.livingVoid = { ...living, w: 0, d: 0 };
  assert.doesNotMatch(floorPlan(1, false, false, {}, planSourceFromDraft(draft, 1)), /data-auto-guard="living"/);
});

test("完整房屋与编辑三维沿相同挑空边线生成，切造型后增量模型不会复用旧楼层", () => {
  const { draft, floor, living } = fixture();
  draft.floors[1] = floor; draft.livingVoid = living;
  const material = mat(), layout = villaLayoutFromDraft(draft);
  const first = buildVilla(material, false, 4.5, "joined", layout);
  const editor = buildEditorModel(draft, material, 1200, { floors: [1] });
  const endpoints = (root: THREE.Object3D) => {
    const result: number[][][] = [];
    root.getObjectByName("挑空自动栏杆")!.traverse(child => { if (child.userData.railingEndpoints) result.push(child.userData.railingEndpoints); });
    return result;
  };
  assert.equal(endpoints(first.levels[1]).length, 4);
  assert.deepEqual(endpoints(first.levels[1]), endpoints(editor.levels[1]));
  applyVillaParams({ ...DEFAULT_VILLA_PARAMS, livingRailingStyle: "steel", stairRailingStyle: "glass" });
  const next = buildVilla(material, false, 4.5, "joined", layout, first);
  assert.notEqual(next.levels[1], first.levels[1]);
  assert.notEqual(next.signatures.levels[0], first.signatures.levels[0]);
  next.levels[1].getObjectByName("挑空自动栏杆")!.traverse(child => {
    if (child.userData.railingStyle) assert.equal(child.userData.railingStyle, "steel");
  });
  draft.livingVoid.railingStyle = "marble";
  draft.stairLayout.railingStyle = "steel";
  const chosenLayout = villaLayoutFromDraft(draft);
  const chosen = buildVilla(material, false, 4.5, "joined", chosenLayout, next);
  const chosenEditor = buildEditorModel(draft, material, 1200, { floors: [1] });
  assert.notEqual(chosen.levels[1], next.levels[1], "对象造型改变时增量楼层必须更新");
  for (const root of [chosen.levels[1], chosenEditor.levels[1]]) {
    const livingGuard = root.getObjectByName("挑空自动栏杆")!;
    livingGuard.traverse(child => { if (child.userData.railingStyle) assert.equal(child.userData.railingStyle, "marble"); });
    const styles = new Set<string>();
    root.traverse(child => { if (child.userData.railingStyle) styles.add(child.userData.railingStyle); });
    assert.deepEqual(styles, new Set(["marble", "steel"]), "完整与编辑三维优先读取各对象的造型");
  }
  const plan = floorPlan(1, false, false, {}, planSourceFromDraft(draft, 1));
  assert.match(plan, /data-auto-guard="living" data-railing-style="marble"/);
  assert.match(plan, /data-auto-guard="stair" data-railing-style="steel"/);
  assert.equal(getVillaParams().livingRailingStyle, "steel", "对象修改不覆盖旧全局参数");
  assert.equal(getVillaParams().stairRailingStyle, "glass");
  disposeEditorModel(chosenEditor.root, new THREE.Scene());
  disposeEditorModel(editor.root, new THREE.Scene());
  for (const model of [first, next, chosen]) model.group.traverse(child => { if (child instanceof THREE.Mesh) child.geometry.dispose(); });
});

test("主辅楼镜像／凹入门厅下只在实际楼板上的边线生成栏杆", () => {
  for (const buildingPlacement of ["main-east", "main-west"] as const) for (const porticoStyle of ["projecting", "recessed"] as const) {
    applyVillaParams({ ...DEFAULT_VILLA_PARAMS, buildingPlacement, porticoStyle });
    const { draft, floor } = fixture();
    const front = recessedFloor(floor);
    const living = { x: site.main.x + site.main.w / 2 - 1000, z: floor.front, w: 2000, d: 4000 };
    const rails = livingVoidGuards(living, front, resolveLayoutFacades(draft).facades[1], "brick");
    assert.ok(rails.length > 0);
    if (porticoStyle === "recessed") for (const [a, b] of rails) {
      const north = Math.min(a[1], b[1]);
      assert.ok(north > floor.front + site.portico.projection, `凹口内不能悬空放栏杆: ${north}`);
    }
  }
});

test("长直段只在端头保留小主柱，石材截面随二维占地同步缩细", () => {
  for (const style of ["marble", "brick"] as const) for (const rise of [0, 1800, -1800]) {
    const rail = railingModel(new THREE.Group(), new THREE.Vector3(), new THREE.Vector3(5000, rise, 0), style);
    const posts = rail.children.filter(child => child.name === "大理石主柱");
    assert.equal(posts.length, 2, "长直段中间不插大方柱");
    for (const post of posts) {
      const bounds = new THREE.Box3().setFromObject(post), center = bounds.getCenter(new THREE.Vector3());
      assert.ok(center.x < 150 || center.x > 4850, "主柱只在端头");
      assert.ok(bounds.max.x - bounds.min.x <= 111);
    }
    const bounds = new THREE.Box3().setFromObject(rail);
    assert.ok(bounds.max.z - bounds.min.z <= railingThickness(style) + .1, "所有构件在二维栏杆占地内");
    assert.ok(railingThickness(style) <= 150);
  }
});

test("木立柱与大理石栏杆落在真实踏面，柱间通透且旧砖柱不再出现砖色或灰缝", () => {
  const a = new THREE.Vector3(0, 0, 0), b = new THREE.Vector3(2000, 1000, 0);
  const footing = Array.from({ length: 6 }, (_, i) => ({ t: i / 5, y: Math.min(1000, (i + 1) * 200) }));
  const wood = railingModel(new THREE.Group(), a, b, "wood", 950, footing);
  for (const post of wood.children.filter(child => child.name === "主立柱")) {
    const bound = new THREE.Box3().setFromObject(post);
    const center = bound.getCenter(new THREE.Vector3());
    const expected = footing.filter(p => p.t <= center.x / 2000).at(-1)!.y;
    assert.ok(Math.abs(bound.min.y - expected) < .1);
  }
  for (const style of ["brick", "marble"] as const) for (const rise of [0, 1000, -1000]) {
    const steps = footing.map(p => ({ t: p.t, y: rise === 0 ? 0 : rise > 0 ? p.y : 1000 - p.y }));
    const start = new THREE.Vector3(0, rise < 0 ? 1000 : 0, 0);
    const end = new THREE.Vector3(2000, rise > 0 ? 1000 : 0, 0);
    const root = railingModel(new THREE.Group(), start, end, style, 950, steps);
    root.updateMatrixWorld(true);
    assert.equal(root.userData.railingStyle, "marble");
    assert.equal(root.name, "室内栏杆 · 大理石栏杆");
    root.traverse(child => {
      assert.doesNotMatch(child.name, /砖|灰缝|错缝/);
      if (child instanceof THREE.Mesh) {
        const material = child.material as THREE.MeshStandardMaterial;
        assert.equal(material.color.getHexString(), "f4f0e8");
        assert.ok(material.map);
      }
    });
    const bases = root.children.filter(child => child.name === "主柱柱脚" || child.name === "栏杆柱底座");
    assert.ok(bases.length > 4);
    const positions = bases.map(base => {
      const bound = new THREE.Box3().setFromObject(base), center = bound.getCenter(new THREE.Vector3());
      const expected = steps.filter(p => p.t <= center.x / 2000 + 1e-8).at(-1)!.y;
      assert.ok(Math.abs(bound.min.y - expected) < .1, `${style}柱脚必须贴踏步`);
      return center.x;
    }).sort((a, b) => a - b);
    for (let i = 1; i < positions.length; i++) {
      const x = (positions[i - 1] + positions[i]) / 2, y = start.y + rise * x / 2000 + 500;
      const ray = new THREE.Raycaster(new THREE.Vector3(x, y, -1000), new THREE.Vector3(0, 0, 1));
      assert.equal(ray.intersectObject(root, true).length, 0, `${style}柱间不能有实墙`);
    }
    const spindles = root.children.filter(child => child.name === "花瓶栏杆柱") as THREE.Mesh[];
    assert.ok(spindles.every(column => column.geometry instanceof THREE.LatheGeometry && column.rotation.x === 0 && column.rotation.z === 0));
  }
});
