import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clonePublishedLayout,
  draftHasStair,
  placeStairAt,
  removeStairFromDraft,
} from "../src/layout-draft.ts";

test("删除楼梯后三层都不再有楼梯房间与 draftHasStair", () => {
  const draft = clonePublishedLayout();
  assert.equal(draftHasStair(draft), true);
  removeStairFromDraft(draft);
  assert.equal(draftHasStair(draft), false);
  for (const floor of draft.floors) {
    assert.equal(floor.rooms.some((r) => r.kind === "stair"), false);
    assert.equal(floor.rooms.some((r) => r.name === "楼梯"), false);
  }
});

test("放置楼梯会同步三层房间框到点击中心", () => {
  const draft = clonePublishedLayout();
  removeStairFromDraft(draft);
  // 清空开间轴，避免落点被吸附偏离点击中心
  for (const floor of draft.floors) {
    floor.rooms = [];
    floor.partitions = [];
  }
  const cx = 18000;
  const cz = 3000;
  placeStairAt(draft, cx, cz);
  assert.equal(draftHasStair(draft), true);
  assert.equal(draft.floors.filter((f) => f.rooms.some((r) => r.kind === "stair")).length, 3);
  const room = draft.stairLayout.room;
  // snapMeter 取整；缩放后面宽非整数时中心可偏 <1 mm
  assert.ok(Math.abs(room.x + room.w / 2 - cx) < 1);
  assert.ok(Math.abs(room.z + room.d / 2 - cz) < 1);
  for (const floor of draft.floors) {
    const stairRoom = floor.rooms.find((r) => r.kind === "stair")!;
    assert.equal(stairRoom.name, "楼梯");
    assert.equal(stairRoom.x, room.x);
    assert.equal(stairRoom.z, room.z);
  }
});
