/** 仅在三维可见时同步最新内容；合并绘制等待期间的连续修改。 */
export class DeferredSceneUpdate<T> {
  private dirty = true;
  private appliedKey: string | undefined;
  private running: Promise<void> | null = null;

  constructor(private readonly options: {
    visible: () => boolean;
    capture: () => { key: string; value: T };
    apply: (value: T) => void;
    loading: (work: () => void) => Promise<void>;
  }) {}

  invalidate(): void { this.dirty = true; }

  flush(): Promise<void> {
    if (this.running) return this.running;
    if (!this.dirty || !this.options.visible()) return Promise.resolve();
    this.running = this.update().finally(() => { this.running = null; });
    return this.running;
  }

  private async update(): Promise<void> {
    while (this.dirty && this.options.visible()) {
      if (this.options.capture().key === this.appliedKey) {
        this.dirty = false;
        return;
      }
      await this.options.loading(() => {
        // 遮罩先绘制；期间可能已切回二维或载入了另一份草稿。
        if (!this.options.visible()) return;
        const latest = this.options.capture();
        if (latest.key !== this.appliedKey) this.options.apply(latest.value);
        this.appliedKey = latest.key;
        this.dirty = false;
      });
    }
  }
}

/** 指针移动、选择和提交在同一帧只重绘一次。 */
export class FrameRedraw {
  private frame: number | null = null;
  constructor(
    private readonly draw: () => void,
    private readonly request = (callback: FrameRequestCallback) => requestAnimationFrame(callback),
    private readonly cancel = (frame: number) => cancelAnimationFrame(frame),
  ) {}
  get pending(): boolean { return this.frame !== null; }
  schedule(): void {
    if (this.frame !== null) return;
    this.frame = this.request(() => {
      this.frame = null;
      this.draw();
    });
  }
  clear(): void {
    if (this.frame !== null) this.cancel(this.frame);
    this.frame = null;
  }
}
