import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { loadingOverlayHtml, withLoadingOverlay } from "../src/loading-overlay.ts";

class OverlayElement {
  hidden = true;
  attributes = new Map<string, string>();
  text = { textContent: "" };
  classList = { remove: (_name: string) => {} };
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  querySelector() { return this.text; }
  get element() { return this as unknown as HTMLElement; }
}

function frames(t: TestContext) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame");
  const callbacks: FrameRequestCallback[] = [];
  let number = 0;
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => { callbacks.push(callback); return callbacks.length; },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "requestAnimationFrame", original);
    else delete (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame;
  });
  return async () => {
    for (const callback of callbacks.splice(0)) callback(++number * 16);
    // 等待 async 任务、finally 和任务结果的微任务链完成。
    for (let step = 0; step < 6; step++) await Promise.resolve();
  };
}

test("统一遮罩模板转义文案与属性，并提供可读的加载状态", () => {
  const html = loadingOverlayHtml({ id: 'model"view', text: '<模型> & "场地"', className: 'test"class' });
  assert.match(html, /class="app-loading-overlay test&quot;class" hidden/);
  assert.match(html, /role="status" aria-live="polite" aria-busy="false"/);
  assert.match(html, /id="model&quot;view-text" data-loading-text>&lt;模型&gt; &amp; &quot;场地&quot;/);
  assert.match(html, /app-loading-spinner" aria-hidden="true"/);
  assert.match(loadingOverlayHtml({ id: "visible", text: "加载中", hidden: false }), /aria-busy="true"/);
});

test("同步重任务必须等遮罩先绘制，完成后保持至结果帧呈现", async t => {
  const frame = frames(t);
  const overlay = new OverlayElement();
  let executed = false;
  const result = withLoadingOverlay(overlay.element, "正在更新立体画面", () => {
    executed = true;
    assert.equal(overlay.hidden, false);
    return 42;
  });
  assert.equal(overlay.hidden, false);
  assert.equal(overlay.text.textContent, "正在更新立体画面");
  assert.equal(overlay.attributes.get("aria-busy"), "true");
  assert.equal(executed, false);
  await frame();
  assert.equal(executed, false);
  await frame();
  assert.equal(executed, true);
  assert.equal(overlay.hidden, false);
  await frame();
  assert.equal(overlay.hidden, false);
  await frame();
  assert.equal(await result, 42);
  assert.equal(overlay.hidden, true);
  assert.equal(overlay.attributes.get("aria-busy"), "false");
});

test("任务失败原样抛错并关闭遮罩，之后仍可正常重试", async t => {
  const frame = frames(t);
  const overlay = new OverlayElement();
  const failure = new Error("构建失败");
  const result = withLoadingOverlay(overlay.element, "正在更新", () => { throw failure; });
  const checked = assert.rejects(result, error => error === failure);
  for (let step = 0; step < 4; step++) await frame();
  await checked;
  assert.equal(overlay.hidden, true);
  const retry = withLoadingOverlay(overlay.element, "正在重试", () => "已更新", { keepUntilPaint: false });
  await frame();
  await frame();
  assert.equal(await retry, "已更新");
  assert.equal(overlay.hidden, true);
});

test("重叠任务结束顺序不同，也不会提前关闭并恢复仍在执行的文案", async t => {
  const frame = frames(t);
  const overlay = new OverlayElement();
  let finishFirst!: (value: string) => void;
  let finishSecond!: (value: string) => void;
  const first = withLoadingOverlay(overlay.element, "正在更新模型", () => new Promise<string>(resolve => { finishFirst = resolve; }));
  await frame();
  await frame();
  const second = withLoadingOverlay(overlay.element, "正在准备图片", () => new Promise<string>(resolve => { finishSecond = resolve; }));
  await frame();
  await frame();
  assert.equal(overlay.text.textContent, "正在准备图片");
  finishSecond("图片完成");
  // 先让任务返回进入 finally，再推进两帧。
  await Promise.resolve();
  await Promise.resolve();
  await frame();
  await frame();
  assert.equal(await second, "图片完成");
  assert.equal(overlay.hidden, false);
  assert.equal(overlay.attributes.get("aria-busy"), "true");
  assert.equal(overlay.text.textContent, "正在更新模型");
  finishFirst("模型完成");
  await Promise.resolve();
  await Promise.resolve();
  await frame();
  await frame();
  assert.equal(await first, "模型完成");
  assert.equal(overlay.hidden, true);
});
