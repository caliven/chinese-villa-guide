/**
 * 尺寸／户型版本：写入仓库 data/尺寸、data/户型，三层户型一体存取。
 */
import {
  DEFAULT_VILLA_PARAMS,
  getVillaParams,
  normalizeGutterBedSlopeDegrees,
  type VillaParams,
  validateVillaParams,
} from "./villa-params";
import {
  parseLayoutDraftManaged,
  type LayoutDraft,
} from "./layout-draft";
import type { CourtyardDimLayout } from "./courtyard-dim-drag";
import { parseCourtyardFinish, type CourtyardFinish } from "./courtyard-finishes";
import { parseRoofStyle, type RoofStyle } from "./roof-options";
import { formatSavedAt, makeVersionId } from "./scheme-store";
import {
  LENGTH_UNITS,
  isMeterLayoutDraft,
  isMeterLengthPayload,
  migrateCourtyardDimLayoutToMm,
  migrateLayoutLengthsToMm,
  migrateVillaParamsToMm,
} from "./units";

export const dataVersionsSchema = "anhua-villa-data-versions-v1" as const;
export const sizeDocSchema = "anhua-villa-尺寸-v1" as const;
export const layoutDocSchema = "anhua-villa-户型-v1" as const;

export type DataKind = "尺寸" | "户型";

export type DataVersionMeta = {
  id: string;
  title: string;
  savedAt: string;
  file: string;
};

export type DataVersionsIndex = {
  schema: typeof dataVersionsSchema;
  kind: DataKind;
  versions: DataVersionMeta[];
};

/** 尺寸版本：方案参数及相关外观／院坪选择（不含户型草稿）。 */
export type SizeVersionDocument = {
  schema: typeof sizeDocSchema;
  /** 长度单位；缺省或 "m" 视为旧米制稿，读入时迁成毫米。 */
  units: typeof LENGTH_UNITS;
  id: string;
  title: string;
  savedAt: string;
  villaParams: VillaParams;
  courtyardDimLayout: CourtyardDimLayout;
  roofStyle: RoofStyle;
  courtyardFinish: CourtyardFinish;
  neighborCourtyardFinish: CourtyardFinish;
};

/** 户型版本：一二三楼一体（LayoutDraft.floors 必为 3 层）。 */
export type LayoutVersionDocument = {
  schema: typeof layoutDocSchema;
  /** 长度单位；缺省或 "m" 视为旧米制稿，读入时迁成毫米。 */
  units: typeof LENGTH_UNITS;
  id: string;
  title: string;
  savedAt: string;
  layoutDraft: LayoutDraft;
};

export type DataPersistResult = {
  ok: boolean;
  via: "api" | "download";
  path?: string;
  message: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function dataKindDir(kind: DataKind) {
  return kind;
}

export function dataIndexUrl(kind: DataKind) {
  return `./data/${encodeURIComponent(kind)}/index.json`;
}

export function dataVersionUrl(kind: DataKind, file: string) {
  return `./data/${encodeURIComponent(kind)}/${encodeURIComponent(file)}`;
}

/** 中文前缀＋日期时间，如 尺寸-20261017-143052 */
export function makeDataVersionTitle(kind: DataKind, now = new Date()) {
  return `${kind}-${makeVersionId(now)}`;
}

function parseCourtyardDimLayout(raw: unknown): CourtyardDimLayout {
  const out: CourtyardDimLayout = {};
  if (!isRecord(raw)) return out;
  for (const [id, value] of Object.entries(raw)) {
    if (typeof value === "number" && Number.isFinite(value)) out[id] = value;
  }
  return out;
}

export function buildSizeVersionDocument(input?: {
  id?: string;
  title?: string;
  courtyardDimLayout?: CourtyardDimLayout;
  roofStyle?: RoofStyle;
  courtyardFinish?: CourtyardFinish;
  neighborCourtyardFinish?: CourtyardFinish;
}): SizeVersionDocument {
  const now = new Date();
  const title = input?.title ?? makeDataVersionTitle("尺寸", now);
  return {
    schema: sizeDocSchema,
    units: LENGTH_UNITS,
    id: input?.id ?? title,
    title,
    savedAt: formatSavedAt(now),
    villaParams: getVillaParams(),
    courtyardDimLayout: input?.courtyardDimLayout ?? {},
    roofStyle: input?.roofStyle ?? "joined",
    courtyardFinish: input?.courtyardFinish ?? "concrete",
    neighborCourtyardFinish: input?.neighborCourtyardFinish ?? "concrete",
  };
}

export function buildLayoutVersionDocument(
  layoutDraft: LayoutDraft,
  input?: { id?: string; title?: string },
): LayoutVersionDocument {
  if (!layoutDraft.floors || layoutDraft.floors.length !== 3) {
    throw new Error("户型版本必须包含一二三楼共三层");
  }
  const now = new Date();
  const title = input?.title ?? makeDataVersionTitle("户型", now);
  return {
    schema: layoutDocSchema,
    units: LENGTH_UNITS,
    id: input?.id ?? title,
    title,
    savedAt: formatSavedAt(now),
    layoutDraft,
  };
}

export function parseSizeVersionDocument(input: unknown): SizeVersionDocument {
  if (!isRecord(input)) throw new Error("尺寸文件不是对象");
  if (input.schema !== sizeDocSchema) throw new Error(`尺寸版本应为 ${sizeDocSchema}`);
  const rawParams = isRecord(input.villaParams) ? input.villaParams : {};
  const meter =
    input.units === "mm"
      ? false
      : input.units === "m" ||
        isMeterLengthPayload(input, {
          mainWidth: typeof rawParams.mainWidth === "number" ? rawParams.mainWidth : undefined,
        });
  const raw: Record<string, unknown> = meter
    ? {
        ...input,
        units: LENGTH_UNITS,
        villaParams: migrateVillaParamsToMm(rawParams),
        courtyardDimLayout: isRecord(input.courtyardDimLayout)
          ? migrateCourtyardDimLayoutToMm(input.courtyardDimLayout as Record<string, number>)
          : input.courtyardDimLayout,
      }
    : input;
  const villaParams = {
    ...DEFAULT_VILLA_PARAMS,
    ...(isRecord(raw.villaParams) ? raw.villaParams : {}),
  } as VillaParams;
  villaParams.gutterBedSlope = normalizeGutterBedSlopeDegrees(villaParams.gutterBedSlope);
  const issues = validateVillaParams(villaParams);
  if (issues.length) throw new Error(issues.map((i) => i.message).join("；"));
  return {
    schema: sizeDocSchema,
    units: LENGTH_UNITS,
    id: typeof raw.id === "string" && raw.id ? raw.id : "尺寸",
    title: typeof raw.title === "string" && raw.title ? raw.title : "尺寸",
    savedAt: typeof raw.savedAt === "string" ? raw.savedAt : formatSavedAt(),
    villaParams,
    courtyardDimLayout: parseCourtyardDimLayout(raw.courtyardDimLayout),
    roofStyle: parseRoofStyle(typeof raw.roofStyle === "string" ? raw.roofStyle : undefined),
    courtyardFinish: parseCourtyardFinish(raw.courtyardFinish),
    neighborCourtyardFinish: parseCourtyardFinish(raw.neighborCourtyardFinish),
  };
}

export function parseLayoutVersionDocument(raw: unknown): LayoutVersionDocument {
  if (!isRecord(raw)) throw new Error("户型文件不是对象");
  if (raw.schema !== layoutDocSchema) throw new Error(`户型版本应为 ${layoutDocSchema}`);
  if (raw.layoutDraft == null) throw new Error("户型版本缺少 layoutDraft");
  const meter =
    raw.units === "mm" ? false : raw.units === "m" || isMeterLayoutDraft(raw.layoutDraft);
  const draftRaw = meter ? migrateLayoutLengthsToMm(raw.layoutDraft) : raw.layoutDraft;
  const layoutDraft = parseLayoutDraftManaged(JSON.stringify(draftRaw));
  if (layoutDraft.floors.length !== 3) throw new Error("户型版本必须包含一二三楼共三层");
  return {
    schema: layoutDocSchema,
    units: LENGTH_UNITS,
    id: typeof raw.id === "string" && raw.id ? raw.id : "户型",
    title: typeof raw.title === "string" && raw.title ? raw.title : "户型",
    savedAt: typeof raw.savedAt === "string" ? raw.savedAt : formatSavedAt(),
    layoutDraft,
  };
}

export function sizeDocToJson(doc: SizeVersionDocument) {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export function layoutDocToJson(doc: LayoutVersionDocument) {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export function emptyDataIndex(kind: DataKind): DataVersionsIndex {
  return { schema: dataVersionsSchema, kind, versions: [] };
}

export function parseDataVersionsIndex(raw: unknown, kind: DataKind): DataVersionsIndex {
  if (!isRecord(raw) || !Array.isArray(raw.versions)) return emptyDataIndex(kind);
  const versions: DataVersionMeta[] = [];
  for (const item of raw.versions) {
    if (!isRecord(item)) continue;
    if (typeof item.id !== "string" || typeof item.file !== "string") continue;
    versions.push({
      id: item.id,
      title: typeof item.title === "string" ? item.title : item.id,
      savedAt: typeof item.savedAt === "string" ? item.savedAt : "",
      file: item.file,
    });
  }
  return { schema: dataVersionsSchema, kind, versions };
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function loadDataVersionsIndex(kind: DataKind): Promise<DataVersionsIndex> {
  const raw = await fetchJson(dataIndexUrl(kind));
  return parseDataVersionsIndex(raw, kind);
}

export async function loadSizeVersion(file: string): Promise<SizeVersionDocument | null> {
  const raw = await fetchJson(dataVersionUrl("尺寸", file));
  if (raw == null) return null;
  try {
    return parseSizeVersionDocument(raw);
  } catch {
    return null;
  }
}

export async function loadLayoutVersion(file: string): Promise<LayoutVersionDocument | null> {
  const raw = await fetchJson(dataVersionUrl("户型", file));
  if (raw == null) return null;
  try {
    return parseLayoutVersionDocument(raw);
  } catch {
    return null;
  }
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

type PersistBody = {
  kind: DataKind;
  document: SizeVersionDocument | LayoutVersionDocument;
  index: DataVersionsIndex;
};

/** 优先 POST 写入 data/；静态服务则下载单个 JSON。 */
export async function persistDataVersion(body: PersistBody): Promise<DataPersistResult> {
  try {
    const res = await fetch("/__data_save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = (await res.json()) as { path?: string };
      return {
        ok: true,
        via: "api",
        path: data.path,
        message: `已保存${body.kind}版本 → ${data.path ?? `data/${body.kind}/`}`,
      };
    }
  } catch {
    /* 静态服务无写入接口时走下载 */
  }

  const file = `${body.document.id}.json`;
  const text =
    body.kind === "尺寸"
      ? sizeDocToJson(body.document as SizeVersionDocument)
      : layoutDocToJson(body.document as LayoutVersionDocument);
  downloadText(file, text);
  return {
    ok: true,
    via: "download",
    message: `已下载 ${file}；请放到 villa-3d-src/data/${body.kind}/ 并更新 index.json（npm run dev 可自动写入）`,
  };
}

export function prependVersionMeta(
  index: DataVersionsIndex,
  meta: DataVersionMeta,
): DataVersionsIndex {
  return {
    schema: dataVersionsSchema,
    kind: index.kind,
    versions: [meta, ...index.versions.filter((v) => v.id !== meta.id)],
  };
}

export function removeVersionMeta(index: DataVersionsIndex, file: string): DataVersionsIndex {
  return {
    schema: dataVersionsSchema,
    kind: index.kind,
    versions: index.versions.filter((v) => v.file !== file && v.id !== file.replace(/\.json$/i, "")),
  };
}

/** 只允许目录内的单个 JSON 文件名，防止路径穿越。 */
export function safeDataVersionFileName(file: string): string | null {
  const name = file.trim().replace(/^.*[/\\]/, "");
  if (!name || name !== file.trim() || name.includes("..") || !/\.json$/i.test(name)) return null;
  if (name === "index.json") return null;
  return name;
}

type DeleteBody = {
  kind: DataKind;
  file: string;
  index: DataVersionsIndex;
};

/** 优先 POST 删除 data/ 下版本文件并更新 index；静态服务则下载新 index 并提示手删文件。 */
export async function deleteDataVersion(body: DeleteBody): Promise<DataPersistResult> {
  const file = safeDataVersionFileName(body.file);
  if (!file) {
    return { ok: false, via: "download", message: "无效的版本文件名" };
  }
  const index = removeVersionMeta(body.index, file);
  try {
    const res = await fetch("/__data_delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: body.kind, file, index }),
    });
    if (res.ok) {
      const data = (await res.json()) as { path?: string };
      return {
        ok: true,
        via: "api",
        path: data.path,
        message: `已删除${body.kind}版本 → ${data.path ?? `data/${body.kind}/${file}`}`,
      };
    }
  } catch {
    /* 静态服务无删除接口 */
  }

  downloadText("index.json", `${JSON.stringify(index, null, 2)}\n`);
  return {
    ok: true,
    via: "download",
    message: `已下载更新后的 index.json；请删掉 villa-3d-src/data/${body.kind}/${file} 并替换同目录 index（npm run dev 可自动删除）`,
  };
}
