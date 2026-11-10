import { porticoStyleLabels, buildingPlacementLabels, thirdFloorModeLabels } from "./building-variants";
import {
  DEFAULT_VILLA_PARAMS,
  ANNEX_ROOF_PARAM_KEYS,
  LOCKED_SITE_WIDTH,
  derivedAnnexSetback,
  derivedWestGap,
  getVillaParams,
  floatingHatHeightLimits,
  derivedPorticoColumnWallGap,
  porticoColumnSpacing,
  type VillaParams,
} from "./villa-params";
import { courtyardFinishLabels } from "./courtyard-finishes";
import { DEFAULT_ROOF_STYLE, roofStyleLabels } from "./roof-options";
import { VILLA_PARAM_NON_LENGTH, formatMm } from "./units";
import { isHalfStoreyScheme } from "./construction-scheme";

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
  "garageFloor",
  "neighborGarageFloor",
  "courtyardMidTotal",
]);

type ParamSection = { heading: string; note?: string; fields: Field[]; roofStyle?: boolean };

type ParamGroup = {
  id: string;
  title: string;
  note?: string;
  fields?: Field[];
  sections?: ParamSection[];
  /** 跟在本页后面的即时铺装选项 */
  extras?: "courtyard-finish";
};

function roofSections(annex = false): ParamSection[] {
  const sections: ParamSection[] = [
    {
      heading: "坡度与官帽",
      roofStyle: true,
      fields: [
        { key: "roofFenShui", label: "四坡分水", min: 1, max: 10 },
        { key: "floatingHatHeightOffset", label: "悬浮官帽升降（正升／负降）", min: -80000, max: 80000 },
      ],
    },
    {
      heading: "飘檐与三眼皮",
      note: "顶檐「飘檐挑出」＝最上层出檐（默认800）。水平级差最多100，窄反坎随顶宽收小。最下层与室内楼板同为120厚。上两级按2∶3分配外挡高度。二楼无天沟飘檐与三楼楼板同标高，前／左右共用挑出参数。",
      fields: [
        { key: "thirdEave", label: "顶檐挑出（最上层）" },
        { key: "secondFrontEave", label: "二楼飘檐挑出" },
      ],
    },
    {
      heading: "天沟",
      note: "内外反坎高度均从结构楼板顶起算，外挡高度不含压顶。槽底在板上做30厚起步找坡。压顶沟侧至少30厚，外侧向上找坡。以下参数用于主楼及官帽。",
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
      note: "梁托顶面贴共同楼板底，尺寸默认500×200×160。长度、间距由顶檐与二楼挑檐共用。「三眼皮至下沿线」从最下层板底量到下沿线上沿，仅作用于屋顶。",
      fields: [
        { key: "corbelLength", label: "梁托长度" },
        { key: "corbelSpacing", label: "梁托中心间距" },
        { key: "corbelCornerSpacing", label: "拐角梁托中心距" },
        { key: "eyelidToFasciaGap", label: "三眼皮至下沿线" },
      ],
    },
  ];
  if (!annex) return sections;
  return sections.map((section, index) => ({
    ...section,
    heading: index === 0 ? "屋面坡度" : section.heading,
    roofStyle: false,
    note: index === 1 ? "辅楼四面独立出檐。最下层与室内楼板同厚、同标高，上两级按2∶3分配外挡高度。水平级差最多100，窄反坎随顶宽收小。"
      : index === 2 ? "辅楼内外反坎均从结构板顶起算，外挡不含压顶。槽底在板上做30厚起步找坡，压顶沟侧至少30厚。"
      : index === 3 ? "仅控制辅楼屋顶的梁托与下沿线。" : undefined,
    fields: section.fields.filter(field => field.key !== "floatingHatHeightOffset" && field.key !== "secondFrontEave")
      .map(field => ({ ...field, key: field.key === "thirdEave" ? "annexEave"
        : ANNEX_ROOF_PARAM_KEYS[field.key as keyof typeof ANNEX_ROOF_PARAM_KEYS] })),
  }));
}

const groups: ParamGroup[] = [
  {
    id: "site",
    title: "总图分配",
    note: `宅基地总面宽锁定 ${LOCKED_SITE_WIDTH}。整体东缘与南墙锚定，西侧余量自动反推；主辅楼可互换，户型及门窗随之镜像。道路、邻房与梯田不换位，主辅楼后墙仍齐平。`,
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
    sections: roofSections(),
    note: "进深加大向北扩；面宽分配按当前主辅楼位置重算。包角柱突出＝柱身比墙面外凸的距离（正面与侧面同值），默认 150。",
    fields: [
      { key: "mainWidth", label: "主楼面宽" },
      { key: "mainDepth", label: "主楼进深" },
      { key: "floor1Height", label: isHalfStoreyScheme ? "院坪至二层地面（含入户抬高）" : "一层层高" },
      { key: "floor2Height", label: "二层层高" },
      { key: "floor3Height", label: isHalfStoreyScheme ? "半层地面至屋脊最高点（含屋面）" : "三层层高" },
      { key: "thirdSetback", label: isHalfStoreyScheme ? "半层北向退台" : "三楼北向退台" },
      { key: "cornerProject", label: "包角柱突出墙面", min: 50, max: 500 },
    ],
  },
  {
    id: "portico",
    title: "门厅",
    note: "凸出式飘檐收口拐角距柱身两个外沿各留截面的1/8，改柱宽自动联动（800柱留100）。平齐式（原凹入式）保持大门和主体墙原位，删除门厅柱、横梁及外伸区域，二楼改为连续直檐；三楼官帽保持原样。",
    fields: [
      { key: "porticoWidth", label: "堂屋／门厅面宽（柱心距）" },
      { key: "porticoProjection", label: "凸出式外伸／官帽定位深度" },
      { key: "porticoColumnSize", label: "门厅柱截面" },
    ],
  },
  {
    id: "annex",
    title: "辅楼",
    sections: roofSections(true),
    note: "后墙与主楼齐平；改进深只动前墙，内退＝主楼进深−辅楼进深（自动）。面宽按当前主辅楼位置分配。",
    fields: [
      { key: "annexWidth", label: "辅楼面宽" },
      { key: "annexDepth", label: "辅楼进深" },
      { key: "annexHeight", label: "辅楼一层高度" },
      { key: "annexSetback", label: "相对主楼前墙内退（自动）", min: 0, readonly: true },
    ],
  },
  {
    id: "yard",
    title: "场地院坪",
    note: "总进深＝屋后至老水泥边＋前院外伸。外沿按圆弧：改东／西两端时保持当前弧的半径，中间取样总进深自动重算；地库外沿柱距边固定、纵梁进深跟着变。",
    extras: "courtyard-finish",
    fields: [
      { key: "oldDepth", label: "屋后至老水泥边" },
      { key: "courtyardEastTotal", label: "东界总进深" },
      { key: "courtyardWestTotal", label: "西端总进深" },
      { key: "courtyardMidTotal", label: "中间取样总进深（两端驱动，自动）", readonly: true },
      { key: "courtyardMidFromEast", label: "中间取样距东界" },
      { key: "entranceRise", label: "一层室内抬高示意" },
      { key: "outsideWall", label: "外墙厚示意" },
      { key: "partition", label: "隔墙厚示意" },
    ],
    sections: [
      {
        heading: "地库标高",
        note: "院坪完成面为 ±0。两家地库下面分开：柱、梁互不跨接；院坪楼板齐平、外沿一条线。柱顶贴梁底、梁顶贴楼板底。柱截面、梁宽、自家楼板厚可调；邻居院坪已建、楼板厚固定 150。外沿矮墙保持原高度、水泥色。示意值，不是联测。",
        fields: [
          { key: "garageClear", label: "自家地库净高" },
          { key: "deckStructure", label: "自家梁底距院坪" },
          { key: "garageColumnSize", label: "地库柱边长", min: 300, max: 800 },
          { key: "garageBeamWidth", label: "地库梁宽", min: 200, max: 800 },
          { key: "garageSlabThickness", label: "自家院坪楼板厚", min: 120, max: 400 },
          { key: "garageFloor", label: "自家地库完成面", readonly: true, min: -20000, max: 0 },
          { key: "neighborBeamDrop", label: "邻居梁底距院坪" },
          { key: "neighborBeamClear", label: "邻居地面至最低梁净高" },
          { key: "neighborSlabClear", label: "邻居地面至板底净高（板厚已建 150）", readonly: true },
          { key: "neighborGarageFloor", label: "邻居地库完成面", readonly: true, min: -20000, max: 0 },
          { key: "neighborBeamReach", label: "外层车道宽／邻居外侧柱距外沿", min: 2200 },
          { key: "neighborColumnEdgeInset", label: "邻居柱距院坪边缘", min: 400 },
        ],
      },
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

/** 默认拒绝负数；仅升降等显式允许负值的字段启用有符号解析。 */
export function parseVillaParamNumber(raw: string, signed = false): number | null {
  const text = raw.trim().replace(/[，．。,]/g, ".").replace(/[−－]/g, "-");
  if (!text) return null;
  if (!(signed ? /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/ : /^(?:\d+(?:\.\d*)?|\.\d+)$/).test(text)) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || (!signed && value < 0)) return null;
  return value;
}

/** 展示用：长度为整数 mm；分水／角度类最多两位小数，去掉多余尾零。 */
function formatParamValue(value: number, key?: string) {
  if (key && VILLA_PARAM_NON_LENGTH.has(key)) {
    return String(Math.round(value * 100) / 100);
  }
  return formatMm(value);
}

function numInput(f: Field, value: number, disabled = false) {
  const min = f.min ?? 1;
  const max = f.max ?? 80000;
  const suffix = f.unit ? `（${f.unit}）` : "";
  const ro = f.readonly || DERIVED_PARAM_KEYS.has(f.key);
  return `<label class="select-label params-field${ro ? " is-derived" : ""}">${f.label}${suffix}
    <input type="text" inputmode="decimal" data-villa-param="${f.key}" data-param-min="${min}" data-param-max="${max}" value="${formatParamValue(value, f.key)}" autocomplete="off" spellcheck="false"${ro ? " readonly tabindex=\"-1\"" : ""}${disabled ? " disabled" : ""}/>
  </label>`;
}

function fieldsGridHtml(fields: Field[], params: VillaParams) {
  return `<div class="params-grid">${fields.map((f) => numInput(f, params[f.key] as number, (f.key === "thirdSetback" && params.thirdFloorMode === "flush") || (f.key === "porticoColumnSize" && params.porticoStyle === "recessed"))).join("")}</div>`;
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
        `<button type="button" data-roof-style="${value}" aria-pressed="${value === DEFAULT_ROOF_STYLE}" class="${value === DEFAULT_ROOF_STYLE ? "active" : ""}">${label}</button>`,
    )
    .join("");
  return `<div class="params-choice-block">
    <h3 class="params-subhead">官帽造型</h3>
    <p class="micro">即时生效，无需点「应用」。</p>
    <div class="segmented" role="group" aria-label="官帽造型">${buttons}</div>
    <p class="micro">升降单位 mm：0 为默认自动位置，正值整体抬高、负值整体降低；柱顶和斜接收口同步重算。</p>
    <p class="micro" id="floating-hat-height-range"></p>
    <p class="micro" id="roof-style-note">悬浮官帽为默认方案；帽顶落差可调，纵脊接入正屋。</p>
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

function variantChoices(key: "porticoStyle" | "buildingPlacement" | "thirdFloorMode", label: string, labels: Record<string, string>, params: VillaParams) {
  return `<div class="params-choice-block"><h3 class="params-subhead">${label}</h3><p class="micro">即时切换并重算；包含面板中已输入的尺寸。</p><div class="segmented" role="group" aria-label="${label}">${Object.entries(labels).map(([value, text]) => `<button type="button" data-building-variant="${key}" data-variant-value="${value}" aria-pressed="${params[key] === value}" class="${params[key] === value ? "active" : ""}">${text}</button>`).join("")}</div></div>`;
}

function paneBodyHtml(g: ParamGroup, params: VillaParams) {
  const body = fieldsGridHtml(g.fields ?? [], params) + (g.sections ?? [])
    .map(s => `<div class="params-subgroup">
      <h3 class="params-subhead">${s.heading}</h3>
      ${s.note ? `<p class="micro">${s.note}</p>` : ""}
      ${fieldsGridHtml(s.fields, params)}
      ${s.roofStyle ? roofStyleGroupHtml() : ""}
    </div>`).join("");
  const extras = g.extras === "courtyard-finish" ? courtyardFinishGroupHtml() : "";
  const choices = g.id === "site" ? variantChoices("buildingPlacement", "主辅楼位置", buildingPlacementLabels, params)
    : g.id === "portico" ? variantChoices("porticoStyle", "门厅造型", porticoStyleLabels, params)
    : g.id === "main" ? variantChoices("thirdFloorMode", isHalfStoreyScheme ? "半层模式" : "三楼模式", thirdFloorModeLabels, params)
      + (isHalfStoreyScheme ? '<p class="micro">调整半层坡下围护的北侧范围；屋脊最高点按层高总预算控制，不生成原三楼露台与官帽高柱。</p>' : '<p class="micro">不内退：三楼两翼与二楼前墙齐平，取消两侧露台、栏杆和短柱，保留中央门厅露台。退台尺寸暂存，切回北向内退时恢复。</p>') : "";
  return `${g.note ? `<p class="micro">${g.note}</p>` : ""}${choices}${body}${extras}`;
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
            <div class="params-meta-item" data-portico-column-meta${params.porticoStyle === "recessed" ? " hidden" : ""}>
              <dt>门厅柱心距</dt>
              <dd><strong id="villa-params-portico-span">${formatMm(porticoColumnSpacing(params))}</strong><span>· 柱心对齐门厅前沿两角</span></dd>
            </div>
            <div class="params-meta-item" data-portico-column-meta${params.porticoStyle === "recessed" ? " hidden" : ""}>
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
    if (DERIVED_PARAM_KEYS.has(key) || input.readOnly || input.disabled) return;
    if (options?.finalize) sanitizeVillaParamInput(input, true);
    const field = fieldByKey.get(key);
    const value = parseVillaParamNumber(input.value, (field?.min ?? 0) < 0);
    if (value == null) return;
    const min = field?.min ?? 0;
    const max = field?.max ?? 80000;
    const clamped = Math.min(max, Math.max(min, value));
    // 长度字段取整 mm；分水／角度类保留小数。
    (next as unknown as Record<string, number>)[key] = VILLA_PARAM_NON_LENGTH.has(key) ? clamped : Math.round(clamped);
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
  const height = root.querySelector("#construction-height-status");
  if (height) {
    const applied = getVillaParams();
    height.textContent = `已应用屋脊最高点 ${formatMm(applied.floor1Height + applied.floor2Height + applied.floor3Height)} / 10000 · 屋面构造已计入半层预算`;
  }
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
  root.querySelectorAll<HTMLElement>("[data-portico-column-meta]").forEach(el => { el.hidden = params.porticoStyle === "recessed"; });
  setText("villa-params-portico-span", formatMm(porticoColumnSpacing(params)));
  setText("villa-params-portico-wall-gap", formatMm(derivedPorticoColumnWallGap(params)));
  const { minOffset, maxOffset } = floatingHatHeightLimits(params);
  setText("floating-hat-height-range", Number.isFinite(minOffset + maxOffset) && minOffset <= maxOffset
    ? `当前尺寸升降范围：${formatMm(minOffset)}～${formatMm(maxOffset)} mm。`
    : "当前尺寸无法保留自然斜接，请调整门厅进深或屋面分水。");
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
  const ownFloor = -(params.deckStructure + params.garageClear);
  const neighborFloor = -(params.neighborBeamDrop + params.neighborBeamClear);
  for (const [key, value] of [["garageFloor", ownFloor], ["neighborGarageFloor", neighborFloor]] as const) {
    const input = root.querySelector<HTMLInputElement>(`[data-villa-param="${key}"]`);
    if (input && document.activeElement !== input) input.value = formatMm(value);
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
    if (key === "thirdSetback") input.disabled = params.thirdFloorMode === "flush";
    if (key === "porticoColumnSize") input.disabled = params.porticoStyle === "recessed";
  });
  root.querySelectorAll<HTMLButtonElement>("[data-building-variant]").forEach(button => {
    const key = button.dataset.buildingVariant as "porticoStyle" | "buildingPlacement" | "thirdFloorMode";
    const on = params[key] === button.dataset.variantValue;
    button.classList.toggle("active", on);
    button.setAttribute("aria-pressed", String(on));
  });
  updateVillaParamsMeta(params, root);
}

export function sanitizeVillaParamInput(input: HTMLInputElement, finalize: boolean) {
  const min = Number(input.dataset.paramMin ?? 0);
  const max = Number(input.dataset.paramMax ?? 80000);
  const parsed = parseVillaParamNumber(input.value, min < 0);
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
