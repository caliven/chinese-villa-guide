import test from "node:test";
import assert from "node:assert/strict";
import { mountDesignReview } from "../src/design-review";
import { emptySession, validateMeetingView, viewFlags, type MeetingView } from "../src/design-session";
import { DEFAULT_VILLA_PARAMS } from "../src/villa-params";
import { clonePublishedLayout, ensureExteriorManaged, replaceLayoutDraftMemory } from "../src/layout-draft";
import { meetingBooklet, openingSchedule, roomSchedule } from "../src/meeting-booklet";
import { floors, site } from "../src/data";

const view = (): MeetingView => ({
  roofStyle: "joined", courtyardFinish: "concrete", neighborCourtyardFinish: "concrete",
  tab: "floor", camera: "top", level: -1, planMode: "2d", existing: false, balcony: false,
  fenShui: 4.5, roadY: -1860, rampLength: 5000, progress: 0,
  sunDate: "2026-10-26", sunTime: 10, dining: "full",
  flags: Object.fromEntries(viewFlags.map(key => [key, false])), pose: null,
  villaParams: { ...DEFAULT_VILLA_PARAMS },
});

function reviewHarness(restore: () => void | Promise<void> = () => {}) {
  const handlers = new Map<string, (event: unknown) => unknown>();
  const messages: string[] = [];
  const comparison = { innerHTML: "" };
  const root = {
    hidden: false, innerHTML: "",
    addEventListener: (type: string, handler: (event: unknown) => unknown) => handlers.set(type, handler),
    querySelector: (selector: string) => selector === "#review-comparison"
      ? (root.innerHTML.includes('id="review-comparison"') ? comparison : null)
      : selector === "#review-compare-a" ? { value: api.exportSession().snapshots[0].id }
      : selector === "#review-compare-b" ? { value: api.exportSession().snapshots[1].id } : null,
  };
  const api = mountDesignReview(root as unknown as HTMLElement, {
    getView: view, restore, options: () => ({ fenShui: 4.5, roadY: -1860, rampLength: 5000 }),
    navigate: () => {}, image: () => undefined, toast: message => messages.push(message),
  });
  const click = (dataset: Record<string, string>) => handlers.get("click")!({ target: { closest: () => ({ dataset }) } });
  return { api, root, messages, comparison, click };
}

test("院坪快照列表及对比可打开，标高沿用毫米且不冒充旧餐桌人数", async () => {
  const harness = reviewHarness();
  harness.api.saveSnapshot("院坪A");
  harness.api.saveSnapshot("院坪B");
  await harness.click({ reviewPage: "snapshots" });
  assert.match(harness.root.innerHTML, /院坪总图/);
  assert.match(harness.root.innerHTML, /道路-1860 mm（未测）/);
  assert.doesNotMatch(harness.root.innerHTML, /-1860\.00m/);
  assert.match(harness.comparison.innerHTML, /院坪总图／平面/);
  assert.doesNotMatch(harness.comparison.innerHTML, /18座/);
});

test("快照恢复等待异步完成；失败回显且不显示成功", async () => {
  let reject!: (error: Error) => void;
  const harness = reviewHarness(() => new Promise<void>((_resolve, no) => { reject = no; }));
  harness.api.saveSnapshot("失败场景");
  harness.messages.length = 0;
  const pending = harness.click({ restoreSnapshot: harness.api.exportSession().snapshots[0].id });
  assert.equal(harness.messages.length, 0);
  reject(new Error("构建未完成"));
  await pending;
  assert.deepEqual(harness.messages, ["恢复快照失败：构建未完成"]);
});

test("快照尺寸异常在导入/恢复前被拒绝", () => {
  const invalid = view();
  invalid.villaParams.mainWidth = -1;
  assert.throws(() => validateMeetingView(invalid), /方案尺寸无效/);
  assert.equal(validateMeetingView(view()).level, -1);
});

test("房间与洞口表使用当前草稿并保持源数据不变", () => {
  const draft = ensureExteriorManaged(clonePublishedLayout());
  const room = draft.floors[0].rooms.find(room => room.kind !== "void")!;
  room.name = "当前房间<&>";
  draft.exteriorManaged = true;
  const window = draft.exteriorOpenings.find(item => item.floor === 1 && item.facadeIndex === 1 && item.opening.kind === "window")!;
  assert.ok(window);
  window.opening.width = 2370;
  window.opening.height = 1470;
  window.opening.sill = 680;
  const before = structuredClone(draft), dimensions = structuredClone(site), published = structuredClone(floors);
  assert.match(roomSchedule(draft), /当前房间&lt;&amp;&gt;/);
  assert.match(openingSchedule(draft), /2370×1470/);
  assert.match(openingSchedule(draft), /\+4280／\+5750/);
  assert.deepEqual(draft, before);
  assert.deepEqual(site, dimensions);
  assert.deepEqual(floors, published);
});

test("图册平面、房间表及门窗表同时读取当前户型，餐厅说明不残留旧18座", () => {
  const draft = ensureExteriorManaged(clonePublishedLayout());
  draft.floors[0].rooms.find(room => room.kind !== "void")!.name = "本次户型专用房间";
  draft.exteriorManaged = true;
  const window = draft.exteriorOpenings.find(item => item.floor === 1 && item.facadeIndex === 1 && item.opening.kind === "window")!;
  window.opening.width = 2370; window.opening.height = 1470; window.opening.sill = 680;
  replaceLayoutDraftMemory(draft);
  try {
    const book = meetingBooklet(emptySession(), { fenShui: 4.5, roadY: -1860, rampLength: 5000 }, view());
    assert.ok((book.match(/本次户型专用房间/g) ?? []).length >= 2, "平面和房间表均应包含当前房名");
    assert.match(book, /2370×1470/);
    assert.doesNotMatch(book, /本图册的一层满座图是双桌18座/);
  } finally { replaceLayoutDraftMemory(null); }
});
