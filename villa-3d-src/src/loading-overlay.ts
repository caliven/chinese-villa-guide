type LoadingOverlayMarkup = {
  id: string;
  text: string;
  hidden?: boolean;
  className?: string;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

/** 加载遮罩统一结构；文字节点可由控制器更新。 */
export function loadingOverlayHtml({ id, text, hidden = true, className = "" }: LoadingOverlayMarkup): string {
  return `<div id="${escapeHtml(id)}" class="app-loading-overlay${className ? ` ${escapeHtml(className)}` : ""}"${hidden ? " hidden" : ""} role="status" aria-live="polite" aria-busy="${!hidden}"><span class="app-loading-spinner" aria-hidden="true"></span><span id="${escapeHtml(id)}-text" data-loading-text>${escapeHtml(text)}</span></div>`;
}

type LoadingState = { tasks: Map<symbol, string> };
const activeOverlays = new WeakMap<HTMLElement, LoadingState>();

/**
 * 两帧之间浏览器有一次绘制机会。单次 rAF 回调仍在绘制前执行，
 * 不能把同步几何构建直接放入其中，否则遮罩会和重任务一起延迟显示。
 */
function afterPaint(): Promise<void> {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    } else {
      // 无绘制环境（如服务端或单元测试）仍保持异步任务边界。
      setTimeout(resolve, 0);
    }
  });
}

function updateOverlay(element: HTMLElement, state: LoadingState): void {
  const messages = [...state.tasks.values()];
  const busy = messages.length > 0;
  element.hidden = !busy;
  element.setAttribute("aria-busy", String(busy));
  if (busy) {
    const text = element.querySelector<HTMLElement>("[data-loading-text]");
    if (text) text.textContent = messages[messages.length - 1]!;
  }
}

/**
 * 先呈现遮罩，再执行任务。重叠调用各自保留遮罩，全部结束才关闭；
 * 默认等待任务后的绘制，避免三维画面的第一帧尚未显示就露出旧画面。
 * 任务错误原样交给调用方处理，遮罩始终在 finally 中恢复。
 */
export async function withLoadingOverlay<T>(
  element: HTMLElement,
  message: string,
  task: () => T | Promise<T>,
  { keepUntilPaint = true }: { keepUntilPaint?: boolean } = {},
): Promise<T> {
  let state = activeOverlays.get(element);
  if (!state) {
    state = { tasks: new Map() };
    activeOverlays.set(element, state);
  }
  const token = Symbol("loading-task");
  state.tasks.set(token, message);
  element.classList.remove("is-error");
  updateOverlay(element, state);
  try {
    await afterPaint();
    return await task();
  } finally {
    if (keepUntilPaint) await afterPaint();
    state.tasks.delete(token);
    updateOverlay(element, state);
    if (!state.tasks.size) activeOverlays.delete(element);
  }
}
