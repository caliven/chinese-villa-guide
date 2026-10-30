import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { annexDoorMaxHead, facades } from "../src/facades.ts";
import { resolveLayoutFacades } from "../src/facade-layout.ts";
import { site } from "../src/data.ts";
import { applyVillaParams, DEFAULT_VILLA_PARAMS, resetVillaParams } from "../src/villa-params.ts";
import { clonePublishedLayout } from "../src/layout-draft.ts";
import { villaLayoutFromDraft } from "../src/architecture.ts";
import { wallWithOpenings, type Mats } from "../src/primitives.ts";

test.afterEach(resetVillaParams);

test("辅楼外门的洞口和门实体避开檐下线脚，随换位和檐口参数更新", () => {
  for (const buildingPlacement of ["main-east", "main-west"] as const) {
    for (const annexEyelidToFasciaGap of [300, 750]) {
      applyVillaParams({ ...DEFAULT_VILLA_PARAMS, buildingPlacement, annexEyelidToFasciaGap });
      const draft = clonePublishedLayout();
      const resolved = resolveLayoutFacades(villaLayoutFromDraft(draft));
      const doors = resolved.facades[3].flatMap(face => face.openings).filter(o => o.door);
      assert.ok(doors.length);
      for (const door of doors) {
        assert.ok(door.h > 0);
        assert.ok(door.sill + door.h <= annexDoorMaxHead());
        const material = new THREE.MeshBasicMaterial();
        const mat = new Proxy({} as Mats, { get: () => material });
        const wall = wallWithOpenings(new THREE.Group(), [0, 0], [5000, 0], 0, site.annex.height,
          [{ ...door, at: 2500 }], mat);
        wall.updateWorldMatrix(true, true);
        const wallMesh = wall.children[0] as THREE.Mesh;
        const hit = (y: number) => new THREE.Raycaster(new THREE.Vector3(2500, y, 500), new THREE.Vector3(0, 0, -1)).intersectObject(wallMesh);
        assert.equal(hit(door.sill + door.h / 2).length, 0, "门洞应完整贯通墙体");
        assert.ok(hit(door.sill + door.h + 60).length, "门顶以上应有墙体");
        const model = wall.getObjectByName("铸铝咖色大门")!;
        assert.equal(model.userData.doorDimensions.height, door.h);
        assert.ok(new THREE.Box3().setFromObject(model).max.y <= annexDoorMaxHead() + 42);
        material.dispose();
      }
      const defaultDoor = facades(3).flatMap(face => face.openings).find(o => o.door)!;
      assert.ok(defaultDoor.sill + defaultDoor.h <= annexDoorMaxHead());
    }
  }
});
