import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { buildVilla, mainRoofFootprint } from "../src/architecture.ts";
import { construction, floors, frontElevation, site, stairLayout } from "../src/data.ts";
import { stairOpeningBounds } from "../src/stair-geometry.ts";
import { roofEaves } from "../src/facade-details.ts";
import type { Mats } from "../src/primitives.ts";
import { floorSlabThickness, gutterOuterWallTop, roofGutterDesign, roofTileThickness, eaveTrimDesign, frontApronSection } from "../src/roof-options.ts";
import { applyVillaParams, DEFAULT_VILLA_PARAMS, resetVillaParams } from "../src/villa-params.ts";

const mat = new Proxy({} as Mats, {
  get(target, key: keyof Mats) { return target[key] ??= new THREE.MeshPhysicalMaterial() as never; },
});
test.afterEach(resetVillaParams);

function bounds(object: THREE.Object3D) {
  return new THREE.Box3().setFromObject(object);
}

function meshes(root: THREE.Object3D, name: string) {
  const result: THREE.Mesh[] = [];
  root.traverse(object => {
    if (object instanceof THREE.Mesh && object.name === name) result.push(object);
  });
  return result;
}

function close(actual: number, expected: number, message: string) {
  assert.ok(Math.abs(actual - expected) < 0.1, `${message} ${actual} / ${expected}`);
}

test("主辅楼顶檐共用120厚板，反坎与沟底从板顶生成，两种官帽及换位均成立", () => {
  for (const style of ["joined", "floating"] as const) {
    for (const buildingPlacement of ["main-east", "main-west"] as const) {
      applyVillaParams({ ...DEFAULT_VILLA_PARAMS, buildingPlacement, floor3Height: style === "joined" ? 3100 : 3500 });
      const model = buildVilla(mat, false, site.roofFenShui, style);
      model.group.updateMatrixWorld(true);
      close(bounds(model.topSlabs.main).max.y, floors[2].y + floors[2].height,
        "三层层高包含封顶板厚，层高终点为板顶");
      for (const [roof, slab, name] of [
        [model.roof.getObjectByName("正屋四坡")!, model.topSlabs.main, "主楼三层顶板实体"],
        [model.annexRoof, model.topSlabs.annex, "辅楼一层顶板实体"],
      ] as const) {
        const plate = bounds(slab.getObjectByName(name)!);
        const lids = roof.getObjectByName("三眼皮檐口")!;
        const lower = lids.children.map(bounds).sort((a, b) => a.min.y - b.min.y)[0];
        close(lower.min.y, plate.min.y, "最下层檐板底与室内板底齐平");
        close(lower.max.y, plate.max.y, "最下层檐板顶与室内板顶齐平");
        close(lower.max.y - lower.min.y, floorSlabThickness, "檐板同为120厚");
        for (const corbel of meshes(roof, "梁托")) close(bounds(corbel).max.y, plate.min.y, "梁托顶贴板底");
        const outer = bounds(roof.getObjectByName("天沟外挡边")!);
        const inner = bounds(roof.getObjectByName("天沟内挡边")!);
        close(outer.min.y, plate.max.y, "外挡从板顶起砌");
        close(inner.min.y, plate.max.y, "内挡从板顶起砌");
        close(outer.max.y - plate.max.y, 200, "外挡参数直接等于板上高度");
        close(inner.max.y - plate.max.y, 250, "内挡参数直接等于板上高度");
        close(bounds(roof.getObjectByName("天沟槽底")!).min.y, plate.max.y, "找坡层底直接贴板顶");
        close(bounds(lids).max.y, outer.max.y, "外侧三眼皮与外挡同顶");
      }
      const main = mainRoofFootprint();
      close(bounds(model.roof.getObjectByName("正屋四坡")!.getObjectByName("天沟外边反坎压顶")!).max.y,
        main.eave + floorSlabThickness + gutterOuterWallTop(), "立面高度公式与三维压顶最高点一致");
    }
  }
});

test("三层室内、露台、门厅及檐板为一块连续实体，梁托贴板底且瓦底贴板顶", () => {
  for (const porticoStyle of ["projecting", "recessed"] as const)
    for (const thirdFloorMode of ["setback", "flush"] as const)
      for (const buildingPlacement of ["main-east", "main-west"] as const) {
        applyVillaParams({ ...DEFAULT_VILLA_PARAMS, porticoStyle, thirdFloorMode, buildingPlacement,
          floor1Height: 3900, floor2Height: 3700, corbelHeight: 260 });
        const model = buildVilla(mat, false);
        model.group.updateMatrixWorld(true);
        const floor = model.levels[2].getObjectByName("三楼楼板") as THREE.Mesh;
        const plate = bounds(floor);
        assert.equal(meshes(model.levels[2], "三楼楼板").length, 1);
        assert.deepEqual(floor.material, [mat.concrete, mat.british]);
        assert.equal(floor.geometry.groups.length, 2, "整体板只按水泥和英国棕分材质");
        close(plate.max.y, floors[2].y, "室内与全部外伸区域共用板顶");
        close(plate.max.y - plate.min.y, construction.floorSlab, "整体同为120厚");
        for (const name of ["三楼左侧露台", "三楼右侧露台", "外伸门厅三楼平台", "连续挑檐底板",
          "挑檐连续承托梁", "承托梁下沿", "瓦下坡面垫层", "四处柱位实体承台"])
          assert.equal(model.levels[2].getObjectByName(name), undefined, `${name} 不再分块生成`);
        const at = (x: number, z: number) => new THREE.Raycaster(new THREE.Vector3(x, plate.max.y + 10, z),
          new THREE.Vector3(0, -1, 0)).intersectObject(floor, false);
        const hole = stairOpeningBounds(stairLayout);
        assert.equal(at(hole.x + hole.w / 2, hole.z + hole.d / 2).length, 0, "整体板保留楼梯洞口");
        for (const x of [site.portico.x - 10, site.portico.x + 10,
          site.portico.x + site.portico.w - 10, site.portico.x + site.portico.w + 10]) {
          const hits = at(x, thirdFloorMode === "flush" ? floors[2].front + 60 : frontElevation.terraceFront + 60);
          assert.equal(hits.length, 1, "门厅与两翼交接处连续铺板且不重复叠面");
          close(hits[0].point.y, plate.max.y, "交接处无高差");
          assert.equal(hits[0].face!.materialIndex, 0, "可用楼面为水泥色");
        }
        const apron = model.levels[2].getObjectByName("三楼栏杆下飘檐")!;
        for (const corbel of meshes(apron, "梁托")) {
          close(bounds(corbel).max.y, plate.min.y, "梁托顶直接贴板底");
          const tip = new THREE.Vector3(eaveTrimDesign.corbelLength - 10, eaveTrimDesign.corbelHeight - 1, 0)
            .applyMatrix4(corbel.matrixWorld);
          const hits = new THREE.Raycaster(tip, new THREE.Vector3(0, 1, 0)).intersectObject(floor, false);
          assert.ok(hits.length && hits[0].distance < 2, "每根梁托端头均由统一楼板覆盖");
        }
        const section = frontApronSection(floors[2].y + frontElevation.eaveParapet, frontElevation.tiledEaveDrop);
        close(section.fasciaTopY, plate.min.y - eaveTrimDesign.corbelHeight, "下沿线接梁托底");
        const tiles = model.levels[2].getObjectByName("三楼飘檐与露台")!;
        const tileBottom = Math.min(...meshes(tiles, "封闭瓦面").map(tile => bounds(tile).min.y));
        close(tileBottom, plate.max.y, "瓦外沿底直接贴板顶");
        close(section.tileInnerY, plate.max.y + roofTileThickness + frontElevation.tiledEaveDrop, "内瓦沿由板顶推导");
        close(bounds(model.levels[2].getObjectByName("三楼屋檐内挡墙")!).max.y, section.tileInnerY,
          "内挡墙、栏杆与短柱基准跟随瓦内沿");
        const edges = new Map<string, number>();
        const positions = floor.geometry.getAttribute("position"), indices = floor.geometry.index!;
        const vertex = (i: number) => [positions.getX(i), positions.getY(i), positions.getZ(i)].join(",");
        for (let i = 0; i < indices.count; i += 3) for (let j = 0; j < 3; j++) {
          const key = [vertex(indices.getX(i + j)), vertex(indices.getX(i + (j + 1) % 3))].sort().join("/");
          edges.set(key, (edges.get(key) ?? 0) + 1);
        }
        assert.ok([...edges.values()].every(count => count === 2), "板体闭合，内部交接处没有重复竖面或裂缝");
      }
});

test("压顶在0到15度及不同反坎宽度下均保留至少30厚，不产生倒置顶面", () => {
  for (const gutterOuterTopWidth of [150, 300, 450]) {
    for (const gutterCopingSlope of [0, 4, 6, 15]) {
      applyVillaParams({ ...DEFAULT_VILLA_PARAMS, gutterOuterTopWidth, gutterCopingSlope });
      const roof = roofEaves(new THREE.Group(), 0, 0, 12000, 10000, 10500, mat);
      roof.updateMatrixWorld(true);
      const coping = roof.getObjectByName("天沟外边反坎压顶") as THREE.Mesh;
      const positions = coping.geometry.getAttribute("position");
      const columns = new Map<string, number[]>();
      for (let i = 0; i < positions.count; i++) {
        const key = `${positions.getX(i).toFixed(2)},${positions.getZ(i).toFixed(2)}`;
        const heights = columns.get(key) ?? [];
        heights.push(positions.getY(i));
        columns.set(key, heights);
      }
      for (const heights of columns.values()) {
        assert.ok(Math.max(...heights) - Math.min(...heights) >= 29.99, "任意顶点处的压顶竖向厚度均不小于30");
      }
      close(bounds(coping).max.y, 10500 + floorSlabThickness + gutterOuterWallTop(), "高度公式与实际网格一致");
      assert.equal(roofGutterDesign.copingSlopeDegrees, gutterCopingSlope);
    }
  }
});
