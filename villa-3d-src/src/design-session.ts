import { designIssues } from "./design-data";
import { projectMeta } from "./project-meta";
import { parseCourtyardFinish, type CourtyardFinish } from "./courtyard-finishes";
import { parseRoofStyle, type RoofStyle } from "./roof-options";
import { isMeterLengthPayload, migrateVillaParamsToMm } from "./units";
import { DEFAULT_VILLA_PARAMS, validateVillaParams, type VillaParams } from "./villa-params";

export const viewFlags = ["roof", "dimensions", "context", "overlap", "main-building", "annex-building", "neighbor-side", "neighbor-rear", "neighbor-front", "neighbor-roadside", "explode", "chair-clearance", "room-clearance", "room-inside", "route-sweep", "route-clearance", "route-conflicts"] as const;
export interface CameraPose { position: [number, number, number]; target: [number, number, number]; zoom: number }
export interface MeetingView {
  roofStyle: RoofStyle;
  courtyardFinish: CourtyardFinish;
  neighborCourtyardFinish: CourtyardFinish;
  tab: "model" | "floor" | "sun";
  camera: "aerial" | "north" | "south" | "courtyard" | "garage" | "top" | "roadside";
  level: number; planMode: "2d" | "3d"; existing: boolean; balcony: boolean;
  fenShui: number; roadY: number; rampLength: number; progress: number;
  sunDate: string; sunTime: number;
  dining: "full" | "daily";
  flags: Record<string, boolean>;
  pose: CameraPose | null;
  /** 方案尺寸；旧快照缺字段时按默认参数。 */
  villaParams: VillaParams;
}
export interface MeetingSnapshot { id: string; title: string; createdAt: string; revision: string; view: MeetingView }
export const noteStatuses = ["未讨论", "待补资料", "已记录意见"] as const;
export interface IssueNote { status: typeof noteStatuses[number]; owner: string; due: string; body: string }
export interface DesignSession {
  schema: 1; revision: string; brief: string;
  notes: Record<string, IssueNote>; snapshots: MeetingSnapshot[];
}
export const sessionKey = "anhua-villa-design-meeting-v1";
export const emptySession = (): DesignSession => ({ schema: 1, revision: projectMeta.revision, brief: "", notes: {}, snapshots: [] });
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("资料结构不是对象");
  return v as Record<string, unknown>;
};
function string(v: unknown, max: number) {
  if (typeof v !== "string" || v.length > max) throw new Error("文字缺失或超过长度限制");
  return v;
}
/** 旧会议快照的道路标高／坡长为米（|v|≤10）；新快照为毫米。 */
function legacyMm(v: unknown) {
  return typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 10 ? Math.round(v * 1000) : v;
}
function range(v: unknown, min: number, max: number) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new Error("参数超出本模型支持范围");
  return v;
}
function choice<T extends string>(v: unknown, choices: readonly T[]): T {
  if (typeof v !== "string" || !choices.includes(v as T)) throw new Error("存在无法识别的选项");
  return v as T;
}
function bool(v: unknown) {
  if (typeof v !== "boolean") throw new Error("图层状态应为布尔值");
  return v;
}
function date(v: unknown, allowEmpty = false) {
  const s = string(v, 10);
  if (allowEmpty && !s) return s;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0, 10) !== s) throw new Error("日期格式或日期值无效");
  return s;
}
export function validateMeetingView(value: unknown): MeetingView {
  const v = object(value), level = range(v.level, -1, 2);
  if (!Number.isInteger(level)) throw new Error("楼层必须为整数");
  const rawFlags = object(v.flags), flags: Record<string, boolean> = {};
  for (const key of viewFlags) flags[key] = bool(rawFlags[key]);
  let pose: CameraPose | null = null;
  if (v.pose !== null) {
    const p = object(v.pose);
    const vector = (x: unknown): [number, number, number] => {
      if (!Array.isArray(x) || x.length !== 3) throw new Error("机位坐标无效");
      return x.map((n) => range(n, -500, 500)) as [number, number, number];
    };
    pose = { position: vector(p.position), target: vector(p.target), zoom: range(p.zoom, .05, 20) };
    const distance = Math.hypot(...pose.position.map((n, i) => n - pose!.target[i]));
    if (distance < .55 - 1e-8 || distance > 125 + 1e-8) throw new Error("机位与观察点间距超出范围");
  }
  let villaParams: VillaParams = { ...DEFAULT_VILLA_PARAMS };
  if (v.villaParams != null) {
    const rawParams = object(v.villaParams);
    // 旧会议快照的方案尺寸为米：先整体迁成毫米，再叠到默认参数上。
    const raw = isMeterLengthPayload(rawParams, { mainWidth: rawParams.mainWidth }) ? migrateVillaParamsToMm(rawParams) : rawParams;
    const next = { ...DEFAULT_VILLA_PARAMS };
    for (const key of Object.keys(DEFAULT_VILLA_PARAMS) as (keyof VillaParams)[]) {
      if (typeof DEFAULT_VILLA_PARAMS[key] === "number" && typeof raw[key] === "number" && Number.isFinite(raw[key])) (next as unknown as Record<string, unknown>)[key] = raw[key];
      if (key === "porticoStyle" && ["projecting", "recessed"].includes(raw[key] as string)) next.porticoStyle = raw[key] as VillaParams["porticoStyle"];
      if (key === "buildingPlacement" && ["main-east", "main-west"].includes(raw[key] as string)) next.buildingPlacement = raw[key] as VillaParams["buildingPlacement"];
      if (key === "thirdFloorMode" && ["setback", "flush"].includes(raw[key] as string)) next.thirdFloorMode = raw[key] as VillaParams["thirdFloorMode"];
    }
    villaParams = next;
  }
  if (validateVillaParams(villaParams).length) throw new Error("快照中的方案尺寸无效");
  return {
    roofStyle: parseRoofStyle(v.roofStyle),
    courtyardFinish: parseCourtyardFinish(v.courtyardFinish),
    neighborCourtyardFinish: parseCourtyardFinish(v.neighborCourtyardFinish),
    tab: choice(v.tab, ["model", "floor", "sun"]),
    camera: choice(v.camera, ["aerial", "north", "south", "courtyard", "garage", "top", "roadside"]),
    level, planMode: choice(v.planMode, ["2d", "3d"]), existing: bool(v.existing), balcony: bool(v.balcony),
    fenShui: range(v.fenShui, 1, 10), roadY: range(legacyMm(v.roadY), -3800, 0), rampLength: range(legacyMm(v.rampLength), 3000, 10000),
    progress: range(v.progress, 0, 100), sunDate: date(v.sunDate), sunTime: range(v.sunTime, 6, 18),
    dining: choice(v.dining, ["full", "daily"]), flags, pose, villaParams,
  };
}
export function parseSession(raw: string): DesignSession {
  if (raw.length > 2_000_000) throw new Error("资料超过2MB，请使用本页导出的会议JSON");
  const value = object(JSON.parse(raw));
  if (value.schema !== 1) throw new Error("会议资料版本不支持");
  const notes: Record<string, IssueNote> = {};
  const knownIds = new Set(designIssues.map((issue) => issue.id));
  for (const [id, item] of Object.entries(object(value.notes))) {
    if (!knownIds.has(id)) throw new Error(`未知议题编号 ${id}`);
    const n = object(item);
    notes[id] = { status: choice(n.status, noteStatuses), owner: string(n.owner, 100), due: date(n.due, true), body: string(n.body, 3000) };
  }
  if (!Array.isArray(value.snapshots) || value.snapshots.length > 20) throw new Error("快照数量应不超过20个");
  const ids = new Set<string>();
  const snapshots = value.snapshots.map((item) => {
    const s = object(item), id = string(s.id, 100), createdAt = string(s.createdAt, 40);
    if (!/^[\w-]+$/.test(id) || ids.has(id) || !Number.isFinite(Date.parse(createdAt))) throw new Error("快照编号或时间无效");
    ids.add(id);
    return { id, title: string(s.title, 100), createdAt, revision: string(s.revision, 100), view: validateMeetingView(s.view) };
  });
  return { schema: 1, revision: string(value.revision, 100), brief: string(value.brief, 4000), notes, snapshots };
}

export function mergeSessions(current: DesignSession, incoming: DesignSession): DesignSession {
  const snapshots = new Map(current.snapshots.map((s) => [s.id, s]));
  for (const snapshot of incoming.snapshots) snapshots.set(snapshot.id, snapshot);
  if (snapshots.size > 20) throw new Error("合并后超过20个快照，请先删除不需要的快照");
  // 来自文件的同编号议题优先；空白输入也可用于清除过时记录。
  return { schema: 1, revision: projectMeta.revision, brief: incoming.brief || current.brief, notes: { ...current.notes, ...incoming.notes }, snapshots: [...snapshots.values()] };
}
