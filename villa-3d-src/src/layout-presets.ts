/**
 * 内置默认户型版本：源码 `data.ts` 为「默认-版本1」权威几何；
 * `data/户型/` 下两份 JSON 供页面下拉载入／微调后再另存新版本。
 * 「默认-版本2」占位与版本1同稿，待用户口述后再改内容。
 */
export const DEFAULT_LAYOUT_PRESET_IDS = ["默认-版本1", "默认-版本2"] as const;
export type DefaultLayoutPresetId = (typeof DEFAULT_LAYOUT_PRESET_IDS)[number];

export const DEFAULT_LAYOUT_PRESET_META: Record<
  DefaultLayoutPresetId,
  { title: string; file: string; note: string }
> = {
  "默认-版本1": {
    title: "默认-版本1",
    file: "默认-版本1.json",
    note: "当前源码默认室内布局（辅楼＋一二三楼一体）。可在编辑布局里微调后另存新版本。",
  },
  "默认-版本2": {
    title: "默认-版本2",
    file: "默认-版本2.json",
    note: "第二套默认稿占位（初期与版本1相同），待口述后再改；亦可在页面上直接改后另存。",
  },
};
