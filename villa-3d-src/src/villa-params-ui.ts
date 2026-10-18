import {
  DEFAULT_VILLA_PARAMS,
  LOCKED_SITE_WIDTH,
  derivedAnnexSetback,
  derivedWestGap,
  getVillaParams,
  derivedPorticoColumnWallGap,
  porticoColumnSpacing,
  type VillaParams,
} from "./villa-params";
import { courtyardFinishLabels } from "./courtyard-finishes";
import { roofStyleLabels } from "./roof-options";
import { VILLA_PARAM_NON_LENGTH, formatMm } from "./units";

type Field = {
  key: keyof VillaParams;
  label: string;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  /** 自动派生项：只读展示，不参与表单写回。 */
  readonly?: boolean;
};

const DERIVED_PARAM_KEYS = new Set<keyof VillaParams>([
  "westGap",
  "annexSetback",
  "neighborYardBeyondCement",
]);

type ParamSection = { heading: string; note?: string; fields: Field[] };

type ParamGroup = {
  id: string;
  title: string;
  note?: string;
  fields?: Field[];
  sections?: ParamSection[];
  /** 跟在本页后面的即时选项（官帽／铺装） */
  extras?: "roof-style" | "courtyard-finish";
};

const groups: ParamGroup[] = [
  {
    id: "site",
    title: "总图分配",
    note: `宅基地总面宽锁定 ${LOCKED_SITE_WIDTH}。改主辅楼面宽／进深时南墙、东墙不动，只动北墙与西墙；西侧间距由东侧＋主楼＋过道＋辅楼反推。主辅楼后墙齐平，屋后预留共用一个数。`,
    fields: [
      { key: "eastGap", label: "东侧间距（东墙锚定）" },
      { key: "westGap", label: "西侧间距（自动）", readonly: true },
      { key: "lane", label: "子孙道净宽" },
      { key: "rearGap", label: "屋后至梯田边预留" },
    ],
  },
  {
    id: "main",
    title: "主楼",
    note: "面宽加大只向西扩，进深加大只向北扩；东南角不动。包角柱突出＝柱身比墙面外凸的距离（正面与侧面同值），默认 150。",
    fields: [
      { key: "mainWidth", label: "主楼面宽" },
      { key: "mainDepth", label: "主楼进深" },
      { key: "floor1Height", label: "一层层高" },
      { key: "floor2Height", label: "二层层高" },
      { key: "floor3Height", label: "三层层高" },
      { key: "thirdSetback", label: "三楼北向退台" },
      { key: "cornerProject", label: "包角柱突出墙面", min: 50, max: 500 },
    ],
  },
  {
    id: "portico",
    title: "门厅",
    note: "两根门厅柱心落在外伸投影北沿左右两角的直角处；柱内侧至前墙由外伸与柱截面自动算出。",
    fields: [
      { key: "porticoWidth", label: "门厅面宽（柱心距）" },
      { key: "porticoProjection", label: "门厅外伸" },
      { key: "porticoColumnSize", label: "门厅柱截面" },
    ],
  },
  {
    id: "annex",
    title: "辅楼",
    note: "后墙与主楼齐平；改进深只动前墙，内退＝主楼进深−辅楼进深（自动）。面宽加大只向西扩。",
    fields: [
      { key: "annexWidth", label: "辅楼面宽" },
      { key: "annexDepth", label: "辅楼进深" },
      { key: "annexHeight", label: "辅楼一层高度" },
      { key: "annexSetback", label: "相对主楼前墙内退（自动）", min: 0, readonly: true },
    ],
  },
  {
    id: "roof",
    title: "屋面",
    note: "主辅楼四面顶檐与二楼前檐共用天沟／三眼皮／梁托／下沿线造型与参数。外边反坎立面与压顶、三眼皮同为英国棕；梁托／下沿线水包砂。悬浮官帽落脊只在「悬浮接入」造型下生效。",
    extras: "roof-style",
    sections: [
      {
        heading: "坡度与官帽",
        fields: [
          { key: "roofFenShui", label: "四坡分水", min: 1, max: 10 },
          { key: "floatingHatRidgeDrop", label: "悬浮官帽落脊", min: 0 },
        ],
      },
      {
        heading: "飘檐与三眼皮",
        note: "顶檐「飘檐挑出」＝最上层出檐（默认 800）；中层＝挑出−100、最下层＝挑出−200；级差 100 固定。「二楼前檐」为三楼栏杆下飘檐，构造与顶檐相同，挑出单独可调（默认 800）。",
        fields: [
          { key: "thirdEave", label: "顶檐挑出（最上层）" },
          { key: "secondFrontEave", label: "二楼前檐挑出" },
        ],
      },
      {
        heading: "天沟",
        note: "顶檐与二楼前檐共用。",
        fields: [
          { key: "gutterClearWidth", label: "天沟净宽" },
          { key: "gutterClearDepth", label: "外边反坎高" },
          { key: "gutterInnerDepth", label: "内侧反坎高" },
          { key: "gutterOuterTopWidth", label: "外边反坎顶宽" },
          { key: "gutterBedSlope", label: "天沟找坡", unit: "°", min: 0, max: 15 },
          { key: "gutterTileGap", label: "瓦片至内侧天沟顶" },
          { key: "gutterTileOverhang", label: "瓦边探入天沟" },
          { key: "gutterCopingSlope", label: "压顶顶面内倾", unit: "°", min: 0, max: 15 },
        ],
      },
      {
        heading: "梁托与下沿线",
        note: "顶檐与二楼前檐共用。梁托成品 500×200×160；下沿线凸出／高度、压顶外飘为固定造型。",
        fields: [
          { key: "corbelLength", label: "梁托长度" },
          { key: "corbelSpacing", label: "梁托中心间距" },
          { key: "corbelCornerSpacing", label: "拐角梁托中心距" },
          { key: "eyelidToFasciaGap", label: "三眼皮至下沿线" },
        ],
      },
    ],
  },
  {
    id: "yard",
    title: "场地院坪",
    note: "总进深＝屋后至老水泥边＋前院外伸。中间取样点按距东界距离计。",
    extras: "courtyard-finish",
    fields: [
      { key: "oldDepth", label: "屋后至老水泥边" },
      { key: "courtyardEastTotal", label: "东界总进深" },
      { key: "courtyardWestTotal", label: "西端总进深" },
      { key: "courtyardMidTotal", label: "中间取样总进深" },
      { key: "courtyardMidFromEast", label: "中间取样距东界" },
      { key: "entranceRise", label: "一层室内抬高示意" },
      { key: "outsideWall", label: "外墙厚示意" },
      { key: "partition", label: "隔墙厚示意" },
    ],
  },
  {
    id: "neighbor",
    title: "邻居占位",
    note: "平面总图与左侧邻居木房 3D 示意同步；前后邻房／弯道仅随面宽东缘微调，细部仍为照片估算。",
    fields: [
      { key: "neighborWoodWidth", label: "邻居木房面宽" },
      { key: "neighborWoodDepth", label: "邻居木房进深" },
      { key: "neighborCementDepth", label: "邻水泥进深" },
      { key: "neighborYardBeyondCement", label: "水泥外院坪进深（与东界外沿齐平，自动）", readonly: true },
    ],
  },
];

function allFields(g: ParamGroup): Field[] {
  return [...(g.fields ?? []), ...(g.sections ?? []).flatMap((s) => s.fields)];
}

const fieldByKey = new Map(groups.flatMap((g) => allFields(g).map((f) => [f.key, f] as const)));

/** 解析尺寸数字：支持中英文小数点；拒绝负数。 */
export function parseVillaParamNumber(raw: string): number | null {
  const text = raw.trim().replace(/[，．。,]/g, ".");
  if (!text) return null;
  if (/[^\d.]/.test(text)) return null;
  if ((text.match(/\./g) ?? []).length > 1) return null;
  if (text === ".") return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

/** 展示用：长度为整数 mm；分水／角度类最多两位小数，去掉多余尾零。 */
function formatParamValue(value: number, key?: string) {
  if (key && VILLA_PARAM_NON_LENGTH.has(key)) {
    return String(Math.round(value * 100) / 100);
  }
  return formatMm(value);
}

function numInput(f: Field, value: number) {
  const min = f.min ?? 1;
  const max = f.max ?? 80000;
  const suffix = f.unit ? `（${f.unit}）` : "";
  const ro = f.readonly || DERIVED_PARAM_KEYS.has(f.key);
  return `<label class="select-label params-field${ro ? " is-derived" : ""}">${f.label}${suffix}
    <input type="text" inputmode="decimal" data-villa-param="${f.key}" data-param-min="${min}" data-param-max="${max}" value="${formatParamValue(value, f.key)}" autocomplete="off" spellcheck="false"${ro ? " readonly tabindex=\"-1\"" : ""}/>
  </label>`;
}

function fieldsGridHtml(fields: Field[], params: VillaParams) {
  return `<div class="params-grid">${fields.map((f) => numInput(f, params[f.key] as number)).join("")}</div>`;
}

function courtyardChoices(id: string, label: string, name: string) {
  return `<fieldset class="courtyard-choices"><legend>${label}</legend><div>${Object.entries(courtyardFinishLabels)
    .map(
      ([value, finishLabel]) =>
        `<label><input type="radio" id="${id}-${value}" name="${name}" value="${value}" ${value === "concrete" ? "checked" : ""}/><span>${finishLabel}</span></label>`,
    )
    .join("")}</div></fieldset>`;
}

function roofStyleGroupHtml() {
  const buttons = Object.entries(roofStyleLabels)
    .map(
      ([value, label]) =>
        `<button type="button" data-roof-style="${value}" aria-pressed="${value === "joined"}" class="${value === "joined" ? "active" : ""}">${label}</button>`,
    )
    .join("");
  return `<div class="params-choice-block">
    <h3 class="params-subhead">官帽造型</h3>
    <p class="micro">即时生效，无需点「应用」。</p>
    <div class="segmented" role="group" aria-label="官帽造型">${buttons}</div>
    <p class="micro" id="roof-style-note">官帽与正屋同脊高，檐口相连。</p>
  </div>`;
}

function courtyardFinishGroupHtml() {
  return `<div class="params-choice-block">
    <h3 class="params-subhead">院坪铺装</h3>
    <p class="micro">即时生效，无需点「应用」。</p>
    ${courtyardChoices("courtyard-finish", "自家院坪", "courtyard-finish-choice")}
    ${courtyardChoices("neighbor-courtyard-finish", "邻居院坪", "neighbor-courtyard-finish-choice")}
    <p class="micro">地砖：600×600灰色哑光仿石砖。</p>
  </div>`;
}

function paneBodyHtml(g: ParamGroup, params: VillaParams) {
  const body = g.sections?.length
    ? g.sections
        .map(
          (s) => `<div class="params-subgroup">
      <h3 class="params-subhead">${s.heading}</h3>
      ${s.note ? `<p class="micro">${s.note}</p>` : ""}
      ${fieldsGridHtml(s.fields, params)}
    </div>`,
        )
        .join("")
    : fieldsGridHtml(g.fields ?? [], params);
  const extras =
    g.extras === "roof-style"
      ? roofStyleGroupHtml()
      : g.extras === "courtyard-finish"
        ? courtyardFinishGroupHtml()
        : "";
  return `${g.note ? `<p class="micro">${g.note}</p>` : ""}${body}${extras}`;
}

/**
 * 尺寸设置悬浮面板：顶部分组 Tab，底部四颗操作按钮始终可见。
 */
export function villaParamsPanelHtml(params: VillaParams = getVillaParams()) {
  const tabs = groups
    .map(
      (g, i) =>
        `<button type="button" class="params-inner-tab${i === 0 ? " active" : ""}" data-params-tab="${g.id}" aria-selected="${i === 0}" role="tab">${g.title}</button>`,
    )
    .join("");
  const panes = groups
    .map(
      (g, i) =>
        `<div class="params-pane${i === 0 ? " active" : ""}" data-params-pane="${g.id}" role="tabpanel" ${i === 0 ? "" : "hidden"}>${paneBodyHtml(g, params)}</div>`,
    )
    .join("");

  return `<div id="params-float" class="params-float" hidden>
    <section class="params-section params-float-card" id="villa-params-section" aria-labelledby="params-float-title">
      <header class="params-float-head">
        <div class="params-float-intro">
          <div class="params-float-title-row">
            <h2 id="params-float-title">尺寸设置</h2>
            <p class="params-float-hint">单位 mm（角度除外）· 南／东墙锚定 · 点「应用」后重算 · 方案示意非测绘</p>
            <button type="button" class="icon-button params-float-close" data-params-close aria-label="关闭尺寸设置">×</button>
          </div>
          <dl class="params-meta" id="villa-params-meta" aria-live="polite">
            <div class="params-meta-item">
              <dt>总面宽</dt>
              <dd><strong id="villa-params-site-width">${formatMm(LOCKED_SITE_WIDTH)}</strong><span>· 锁定</span></dd>
            </div>
            <div class="params-meta-item">
              <dt>西侧间距</dt>
              <dd><strong id="villa-params-west-gap">${formatMm(derivedWestGap(params))}</strong><span>· 自动</span></dd>
            </div>
            <div class="params-meta-item">
              <dt>辅楼内退</dt>
              <dd><strong id="villa-params-annex-setback">${formatMm(Math.max(0, derivedAnnexSetback(params)))}</strong><span>· 自动</span></dd>
            </div>
            <div class="params-meta-item">
              <dt>门厅柱心距</dt>
              <dd><strong id="villa-params-portico-span">${formatMm(porticoColumnSpacing(params))}</strong><span>· 角心＝面宽</span></dd>
            </div>
            <div class="params-meta-item">
              <dt>柱内侧至前墙</dt>
              <dd><strong id="villa-params-portico-wall-gap">${formatMm(derivedPorticoColumnWallGap(params))}</strong><span>· 派生</span></dd>
            </div>
          </dl>
          <p class="params-meta-warn" id="villa-params-width-sum" hidden></p>
        </div>
      </header>
      <div class="params-inner-tabs-row">
        <div class="params-inner-tabs" role="tablist" aria-label="尺寸分组">${tabs}</div>
        <div class="params-scheme-versions">
          <label class="params-version-label">已存尺寸版本
            <select id="scheme-version-select" aria-label="选择已保存的尺寸版本">
              <option value="">（当前尺寸）</option>
            </select>
          </label>
          <button type="button" class="secondary-button params-compact-btn" id="scheme-load-version">载入</button>
          <button type="button" class="secondary-button params-compact-btn" id="scheme-delete-version">删除</button>
        </div>
      </div>
      <div class="params-section-body" id="villa-params-scroll">
        <div id="villa-params-fields">${panes}</div>
        <p class="params-error" id="villa-params-error" hidden></p>
      </div>
      <footer class="params-float-footer">
        <div class="params-actions" id="villa-params-actions">
          <button type="button" class="primary-button params-compact-btn" id="villa-params-apply">应用参数</button>
          <button type="button" class="secondary-button params-compact-btn" id="scheme-save-current">保存到文件</button>
          <button type="button" class="secondary-button params-compact-btn" id="scheme-save-version">保存版本</button>
          <button type="button" class="secondary-button params-compact-btn" id="villa-params-reset">恢复默认</button>
          <p class="micro params-persist-status" id="scheme-persist-status" aria-live="polite">未保存到文件</p>
        </div>
        <p class="params-busy-note" id="villa-params-busy" hidden>正在重建模型…</p>
      </footer>
    </section>
  </div>`;
}

export function bindParamsInnerTabs(root: ParentNode = document) {
  const section = root.querySelector("#villa-params-section");
  if (!section) return;
  section.querySelectorAll<HTMLButtonElement>("[data-params-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.paramsTab;
      if (!id) return;
      section.querySelectorAll<HTMLButtonElement>("[data-params-tab]").forEach((b) => {
        const on = b.dataset.paramsTab === id;
        b.classList.toggle("active", on);
        b.setAttribute("aria-selected", String(on));
      });
      section.querySelectorAll<HTMLElement>("[data-params-pane]").forEach((pane) => {
        const on = pane.dataset.paramsPane === id;
        pane.classList.toggle("active", on);
        pane.hidden = !on;
      });
    });
  });
}

export function readVillaParamsFromDom(root: ParentNode = document, options?: { finalize?: boolean }): VillaParams {
  // 以当前已应用参数为底，避免某一格读失败时整项悄悄退回仓库默认（例如 1 → 1.8）。
  const next = { ...getVillaParams() };
  root.querySelectorAll<HTMLInputElement>("[data-villa-param]").forEach((input) => {
    const key = input.dataset.villaParam as keyof VillaParams;
    if (!(key in next)) return;
    if (DERIVED_PARAM_KEYS.has(key) || input.readOnly) return;
    if (options?.finalize) sanitizeVillaParamInput(input, true);
    const value = parseVillaParamNumber(input.value);
    if (value == null) return;
    const field = fieldByKey.get(key);
    const min = field?.min ?? 0;
    const max = field?.max ?? 80000;
    const clamped = Math.min(max, Math.max(min, value));
    // 长度字段取整 mm；分水／角度类保留小数。
    (next as Record<string, number>)[key] = VILLA_PARAM_NON_LENGTH.has(key) ? clamped : Math.round(clamped);
  });
  return next;
}

/** DOM 中可编辑项与已应用参数是否不一致（尚未点「应用」）。 */
export function hasPendingVillaParamChanges(root: ParentNode = document): boolean {
  const applied = getVillaParams();
  const draft = readVillaParamsFromDom(root);
  return (Object.keys(applied) as (keyof VillaParams)[]).some((key) => {
    if (DERIVED_PARAM_KEYS.has(key)) return false;
    const a = applied[key];
    const b = draft[key];
    if (typeof a !== "number" || typeof b !== "number") return a !== b;
    return Math.abs(a - b) > 1e-6;
  });
}

/** 只刷新全局摘要／派生数，不改写任何输入框（避免打断正在输入）。 */
export function updateVillaParamsMeta(params: VillaParams, root: ParentNode = document) {
  const west = derivedWestGap(params);
  const setback = derivedAnnexSetback(params);
  const ok = west > 1 && setback >= -1e-6;
  const setText = (id: string, value: string) => {
    const el = root.querySelector(`#${id}`);
    if (el) el.textContent = value;
  };
  setText("villa-params-site-width", formatMm(LOCKED_SITE_WIDTH));
  setText("villa-params-west-gap", formatMm(west));
  setText("villa-params-annex-setback", formatMm(Math.max(0, setback)));
  setText("villa-params-portico-span", formatMm(porticoColumnSpacing(params)));
  setText("villa-params-portico-wall-gap", formatMm(derivedPorticoColumnWallGap(params)));
  const meta = root.querySelector("#villa-params-meta");
  meta?.classList.toggle("is-invalid", !ok);
  const warn = root.querySelector<HTMLElement>("#villa-params-width-sum");
  if (warn) {
    warn.hidden = ok;
    warn.textContent = ok
      ? ""
      : `西侧将为 ${formatMm(west)}、辅楼内退 ${formatMm(setback)}（mm），请减小主／辅楼面宽或东侧／过道`;
  }
  const westInput = root.querySelector<HTMLInputElement>('[data-villa-param="westGap"]');
  if (westInput && document.activeElement !== westInput) westInput.value = formatMm(west);
  const setbackInput = root.querySelector<HTMLInputElement>('[data-villa-param="annexSetback"]');
  if (setbackInput && document.activeElement !== setbackInput) {
    setbackInput.value = formatMm(Math.max(0, setback));
  }
  const nbrYardInput = root.querySelector<HTMLInputElement>('[data-villa-param="neighborYardBeyondCement"]');
  if (nbrYardInput && document.activeElement !== nbrYardInput) {
    nbrYardInput.value = formatMm(Number(params.neighborYardBeyondCement));
  }
}

export function fillVillaParamsDom(
  params: VillaParams,
  root: ParentNode = document,
  options?: { force?: boolean },
) {
  root.querySelectorAll<HTMLInputElement>("[data-villa-param]").forEach((input) => {
    if (!options?.force && document.activeElement === input) return;
    const key = input.dataset.villaParam as keyof VillaParams;
    const value = params[key];
    if (typeof value === "number") input.value = formatParamValue(value, key);
  });
  updateVillaParamsMeta(params, root);
}

export function sanitizeVillaParamInput(input: HTMLInputElement, finalize: boolean) {
  const min = Number(input.dataset.paramMin ?? 0);
  const max = Number(input.dataset.paramMax ?? 80000);
  const parsed = parseVillaParamNumber(input.value);
  if (parsed == null) {
    if (finalize) {
      const key = input.dataset.villaParam as keyof VillaParams | undefined;
      const fallback = key && typeof DEFAULT_VILLA_PARAMS[key] === "number"
        ? (DEFAULT_VILLA_PARAMS[key] as number)
        : min > 0 ? min : 1;
      input.value = formatParamValue(Math.min(max, Math.max(min, fallback)), key);
    }
    return;
  }
  let clamped = Math.min(max, Math.max(min, parsed));
  if (input.dataset.villaParam === "gutterBedSlope") clamped = Math.round(clamped);
  if (finalize || clamped !== parsed) input.value = formatParamValue(clamped, input.dataset.villaParam);
}
