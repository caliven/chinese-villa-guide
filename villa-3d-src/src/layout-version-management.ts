import { buildLayoutVersionDocument, makeDataVersionTitle, type DataVersionsIndex, type LayoutVersionDocument } from "./data-versions";
import type { LayoutDraft } from "./layout-draft";

export function layoutVersionName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 80 || /[\r\n\u0000-\u001f]/.test(name)) {
    throw new Error("请输入 1～80 个字符的户型名称，不支持换行");
  }
  return name;
}

export function suggestLayoutVersionName(base: string, index: DataVersionsIndex): string {
  const name = base.slice(0, 72);
  let candidate = name;
  for (let n = 2; index.versions.some(v => v.title === candidate); n++) candidate = `${name}（${n}）`;
  return candidate;
}

/** 保留建筑外壳、层高与门窗，内部从空白开始；不改传入的当前稿。 */
export function blankLayoutDraft(source: LayoutDraft): LayoutDraft {
  const draft = structuredClone(source);
  for (const floor of draft.floors) {
    floor.rooms = [];
    floor.partitions = [];
    floor.furniture = [];
  }
  draft.annexRooms = [];
  draft.annexPartitions = [];
  draft.annexFurniture = [];
  draft.livingVoid.w = draft.livingVoid.d = 0;
  draft.note = "新建户型：保留建筑外壳、层高与外部门窗，内部布局待设计";
  return draft;
}

/** 名称与文件编号分开；同一秒连续新增／复制也不会覆盖已有文件。 */
export function createLayoutVersion(source: LayoutDraft, title: string, index: DataVersionsIndex, now = new Date()): LayoutVersionDocument {
  const base = makeDataVersionTitle("户型", now);
  let id = base;
  for (let n = 2; index.versions.some(v => v.id === id || v.file === `${id}.json`); n++) id = `${base}-${n}`;
  return buildLayoutVersionDocument(source, { id, title: layoutVersionName(title) });
}

/** 重命名使用已保存的文档，保留顺序、编号、时间和全部图纸内容。 */
export function renameLayoutVersion(doc: LayoutVersionDocument, index: DataVersionsIndex, file: string, title: string) {
  const name = layoutVersionName(title);
  if (!index.versions.some(v => v.id === doc.id && v.file === file)) throw new Error("该户型版本已不存在，请重新载入页面");
  return {
    document: { ...structuredClone(doc), title: name },
    index: { ...index, versions: index.versions.map(v => v.file === file ? { ...v, title: name } : v) },
  };
}
