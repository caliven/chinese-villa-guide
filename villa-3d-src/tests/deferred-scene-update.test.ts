import assert from "node:assert/strict";
import { test } from "node:test";
import { DeferredSceneUpdate, FrameRedraw } from "../src/deferred-scene-update.ts";
import { LayoutEditor } from "../src/layout-editor.ts";
import { clonePublishedLayout, draftToJson } from "../src/layout-draft.ts";

function setup() {
  let visible = false;
  let value = 0;
  let fail = false;
  const applied: number[] = [];
  const waiting: (() => void)[] = [];
  let overlays = 0;
  const sync = new DeferredSceneUpdate({
    visible: () => visible,
    capture: () => ({ key: String(value), value }),
    apply: next => { if (fail) throw new Error("GPU failed"); applied.push(next); },
    loading: async work => {
      overlays++;
      await new Promise<void>(resolve => waiting.push(resolve));
      work();
    },
  });
  return {
    sync, applied, waiting,
    set visible(next: boolean) { visible = next; },
    set value(next: number) { value = next; sync.invalidate(); },
    set fail(next: boolean) { fail = next; },
    get overlays() { return overlays; },
  };
}

test("二维连续编辑不构建立体，切换时仅应用最新草稿", async () => {
  const state = setup();
  for (let i = 1; i <= 10; i++) { state.value = i; await state.sync.flush(); }
  assert.equal(state.overlays, 0);
  state.visible = true;
  const task = state.sync.flush();
  assert.equal(state.overlays, 1);
  state.waiting.shift()!();
  await task;
  assert.deepEqual(state.applied, [10]);
  await state.sync.flush();
  assert.equal(state.overlays, 1);
});

test("遮罩等待期间的请求合并，并读取最新草稿而非旧快照", async () => {
  const state = setup();
  state.visible = true;
  const first = state.sync.flush();
  state.value = 2;
  assert.equal(state.sync.flush(), first);
  state.waiting.shift()!();
  await first;
  assert.deepEqual(state.applied, [2]);
  state.value = 2;
  await state.sync.flush();
  assert.equal(state.overlays, 1, "同内容的另一个暂存时间不触发重建或遮罩");
});

test("遮罩期间切回二维不重建，再次进入三维仍能更新", async () => {
  const state = setup();
  state.visible = true;
  const task = state.sync.flush();
  state.visible = false;
  state.waiting.shift()!();
  await task;
  assert.deepEqual(state.applied, []);
  state.visible = true;
  const retry = state.sync.flush();
  state.waiting.shift()!();
  await retry;
  assert.deepEqual(state.applied, [0]);
});

test("构建失败保留待同步状态，恢复后可以重试", async () => {
  const state = setup();
  state.visible = true;
  state.fail = true;
  const task = state.sync.flush();
  state.waiting.shift()!();
  await assert.rejects(task, /GPU failed/);
  state.fail = false;
  const retry = state.sync.flush();
  state.waiting.shift()!();
  await retry;
  assert.deepEqual(state.applied, [0]);
});

test("等待结果帧时又有编辑，关闭遮罩前后的新草稿不会丢失", async () => {
  let value = 1;
  let finish: (() => void) | undefined;
  const applied: number[] = [];
  const sync = new DeferredSceneUpdate({
    visible: () => true,
    capture: () => ({ key: String(value), value }),
    apply: next => { applied.push(next); },
    loading: async work => {
      work();
      await new Promise<void>(resolve => { finish = resolve; });
    },
  });
  const task = sync.flush();
  assert.deepEqual(applied, [1]);
  value = 2;
  sync.invalidate();
  finish!();
  for (let i = 0; i < 4; i++) await Promise.resolve();
  assert.deepEqual(applied, [1, 2]);
  finish!();
  await task;
});

test("同一帧的选择/拖动/提交只重绘一次，立即重绘可取消排队帧", () => {
  let draws = 0;
  let id = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const redraw = new FrameRedraw(() => { draws++; }, callback => {
    frames.set(++id, callback); return id;
  }, frame => { frames.delete(frame); });
  for (let i = 0; i < 30; i++) redraw.schedule();
  assert.equal(frames.size, 1);
  assert.equal(redraw.pending, true);
  const next = [...frames.values()][0]!;
  frames.clear();
  next(16);
  assert.equal(draws, 1);
  assert.equal(redraw.pending, false);
  redraw.schedule();
  redraw.clear();
  assert.equal(frames.size, 0);
  assert.equal(draws, 1);
});

test("导入和恢复户型会通知场地模型；二维替换后切回三维应用最新布局", async () => {
  let visible = true;
  let editor: LayoutEditor;
  const applied: number[] = [], notifications: boolean[] = [];
  const sync = new DeferredSceneUpdate({
    visible: () => visible,
    capture: () => ({ key: JSON.stringify({ ...editor.draft, updatedAt: "" }), value: editor.draft.floors[0].furniture.length }),
    apply: count => { applied.push(count); },
    loading: async work => { work(); },
  });
  editor = new LayoutEditor({
    getFloor: () => 0, redraw: () => {}, toast: () => {},
    onDraftSaved: (_updatedAt, manual) => { notifications.push(manual); sync.invalidate(); },
  }, clonePublishedLayout());
  const publishedCount = editor.draft.floors[0].furniture.length;
  assert.ok(publishedCount > 0);
  await sync.flush();
  assert.deepEqual(applied, [publishedCount]);

  visible = false;
  const imported = clonePublishedLayout(); imported.floors[0].furniture = [];
  editor.importJson(draftToJson(imported));
  await sync.flush();
  assert.deepEqual(applied, [publishedCount], "二维导入不立即重建场地模型");
  assert.equal(editor.canUndo, false);
  assert.equal(editor.canRedo, false);
  visible = true;
  await sync.flush();
  assert.deepEqual(applied, [publishedCount, 0], "切回三维不能保留导入前的模型");

  visible = false;
  editor.resetToPublished();
  await sync.flush();
  visible = true;
  await sync.flush();
  assert.deepEqual(applied, [publishedCount, 0, publishedCount], "恢复正式户型同样触发同步");
  assert.deepEqual(notifications, [false, false, false]);
  assert.equal(editor.selection, null);
  assert.equal(editor.canUndo, false);
  assert.equal(editor.canRedo, false);
});
