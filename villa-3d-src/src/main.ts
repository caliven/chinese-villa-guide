import "./style.css";
import { VillaViewer, defaultView, type CameraName } from "./viewer";
import { site, floors, facts, photos, annexRooms, buildingAreas } from "./data";
import { floorPlan, courtyardSitePlan, diningClearance, planSourceFromDraft, planSourceFromPublished } from "./plan";
import { LayoutEditor } from "./layout-editor";
import { furniturePickerOrder, furnitureLabels } from "./furniture-catalog";
import { OPENING_KINDS, openingLabels } from "./openings";

const roomKindOptions = [
  ["bed", "卧室"],
  ["living", "客厅"],
  ["hall", "堂屋／过道"],
  ["bath", "卫生间"],
  ["store", "储物"],
] as const;
import { roofPitch } from "./architecture";
import { surroundings } from "./surroundings";
import { garageLayout } from "./garage-layout";
import { formatRouteRanges, routeRanges, type SweepCell } from "./vehicle-route";
import { bedroomSummary, roomReference, type DesignIssue } from "./design-data";
import { mountDesignReview } from "./design-review";
import { viewFlags, type CameraPose, type MeetingView } from "./design-session";
import { projectMeta, escapeHtml } from "./project-meta";
import { parseCourtyardFinish, type CourtyardFinish } from "./courtyard-finishes";
import { parseRoofStyle, type RoofStyle } from "./roof-options";
import {
  bindCourtyardDimDrag,
  clearCourtyardDimLayout,
  loadCourtyardDimLayout,
  replaceCourtyardDimLayout,
  type CourtyardDimLayout,
} from "./courtyard-dim-drag";
import {
  applyVillaParams,
  DEFAULT_VILLA_PARAMS,
  getVillaParams,
  LOCKED_SITE_WIDTH,
  rememberVillaParams,
  saveVillaParams,
  validateVillaParams,
  type VillaParams,
} from "./villa-params";
import {
  bindParamsInnerTabs,
  fillVillaParamsDom,
  readVillaParamsFromDom,
  sanitizeVillaParamInput,
  updateVillaParamsMeta,
  villaParamsPanelHtml,
} from "./villa-params-ui";
import {
  clearLayoutDraft,
  envelopeFromSite,
  loadLayoutDraft,
  replaceLayoutDraftMemory,
  saveLayoutDraft,
  scaleLayoutDraftToEnvelope,
} from "./layout-draft";
import {
  buildSchemeDocument,
  clearLegacyLocalStorage,
  loadCurrentScheme,
  loadSchemeVersion,
  loadSchemeVersionsIndex,
  makeVersionId,
  migrateLegacyLocalStorage,
  persistSchemeFile,
  resetSchemeDocument,
  type SchemeDocument,
  type SchemeVersionsIndex,
} from "./scheme-store";

const shapes: Record<string, string> = {
  house: '<path d="M3 10 12 3l9 7M5 9v12h14V9M10 21v-7h4v7"/>',
  aerial: '<path d="m3 9 9-5 9 5-9 5-9-5Zm0 6 9 5 9-5M3 12l9 5 9-5"/>',
  north: '<path d="M4 21V7l8-4 8 4v14M9 21v-6h6v6M8 8h1m6 0h1M8 11h1m6 0h1"/>',
  south: '<path d="m3 20 7-13 4 6 3-4 4 11H3Z"/><circle cx="17" cy="5" r="2"/>',
  courtyard: '<path d="M4 4h16v16H4zM8 8h8v8H8z"/>',
  garage:
    '<path d="m4 10 2-5h12l2 5M3 10h18v8H3zM6 18v3m12-3v3M6 13h2m8 0h2"/>',
  roadside: '<path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7M7 10h2m6 0h2M7 13h2m6 0h2M4 17h4m8 0h4"/>',
  photo:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="m3 17 6-5 4 4 3-3 5 4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  reset: '<path d="M4 11a8 8 0 1 1 2 7M4 4v7h7"/>',
  save: '<path d="M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6"/>',
  expand: '<path d="M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6"/>',
  arrow: '<path d="m14 5-7 7 7 7"/>',
  close: '<path d="m5 5 14 14M5 19 19 5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
  sliders:
    '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2.2"/><circle cx="8" cy="17" r="2.2"/>',
};
const icon = (name: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name] ?? shapes.info}</svg>`;
const check = (id: string, label: string, checked = false) =>
  `<label class="toggle-row"><span>${label}</span><input type="checkbox" id="${id}" ${checked ? "checked" : ""}/><span class="switch" aria-hidden="true"></span></label>`;
const cameraLabels: Record<string, string> = {
  aerial: "鸟瞰",
  north: "北立面",
  south: "南侧",
  courtyard: "院坪",
  garage: "地库",
  roadside: "蓝顶邻房",
};

document.querySelector("#app")!.innerHTML = `
  ${villaParamsPanelHtml()}
  <header class="app-header">
    <div class="header-brand">
      <a class="back-link" href="../docs/" aria-label="返回建房指南" title="返回建房指南">${icon("arrow")}</a>
      <a href="../docs/" class="brand" aria-label="安化山居，返回建房指南">${icon("house")}<strong>安化 · 山居</strong><span>实景别墅方案</span></a>
    </div>
    <nav aria-label="查看模式" class="main-tabs">
      ${[
        ["model", "场地模型"],
        ["floor", "分层户型"],
        ["sun", "日照分析"],
        ["real", "实景"],
        ["design", "设计沟通"],
        ["sources", "资料与校核"],
        ["originals", "原始资料"],
      ]
        .map(
          ([id, name]) =>
            `<button data-tab="${id}" ${id === "real" ? 'title="合成参考，未同步最新方案；尺寸以场地模型为准。"' : ""} class="${id === "model" ? "active" : ""}" aria-pressed="${id === "model"}">${name}</button>`,
        )
        .join("")}
    </nav>
    <button type="button" class="header-action" id="open-params-panel" aria-pressed="false" title="打开尺寸设置">${icon("sliders")}<span>尺寸设置</span></button>
  </header>
  <main class="workspace">
    <section class="stage" aria-label="方案查看区">
      <div id="viewport"></div>
      <div id="loading"><span class="spinner"></span><strong>正在构建山居场景</strong><span>加载地形、屋顶与楼层模型</span></div>
      <div class="scene-tools" id="scene-tools">
        <button class="icon-button" id="reset-camera" aria-label="恢复当前视角" title="恢复视角">${icon("reset")}</button>
        <button class="icon-button" id="save-view" aria-label="保存当前模型图片" title="保存视图">${icon("save")}</button>
        <button class="icon-button" id="record-view" aria-label="记录当前机位和参数为会议快照" title="记录会议快照">${icon("check")}</button>
        <button class="icon-button" id="fullscreen" aria-label="全屏查看" title="全屏查看">${icon("expand")}</button>
      </div>
      <div class="photo-comparison" id="comparison" hidden><div><strong id="comparison-title"></strong><button id="photo-expand" class="icon-button" aria-label="放大航拍参考">${icon("expand")}</button><button id="close-comparison" class="icon-button" aria-label="关闭航拍对照">${icon("close")}</button></div><img id="comparison-img" alt="航拍对照"/><p id="comparison-note"></p></div>
      <div class="photo-strip" id="photo-strip" aria-label="航拍对照">${photos
        .slice(0, 4)
        .map(
          (p, i) =>
            `<button data-photo="${i}" title="${p.title}" aria-label="对照${p.title}"><img src="./photos/${p.file}" alt="${p.title}"/><span>${p.title}</span></button>`,
        )
        .join("")}</div>
      <div class="camera-bar" id="camera-bar" aria-label="预设视角">${Object.entries(
        cameraLabels,
      )
        .map(
          ([id, name]) =>
            `<button data-camera="${id}" aria-pressed="${id === "aerial"}" class="${id === "aerial" ? "active" : ""}">${icon(id)}<span>${name}</span></button>`,
        )
        .join("")}</div>
      <div class="compass" id="compass"><span>N</span><svg viewBox="0 0 52 52" aria-label="指北针"><circle cx="26" cy="26" r="23"/><g id="compass-arrow"><path d="m26 7 9 34-9-7-9 7Z"/></g></svg></div>
      <div id="plan-panel" class="plan-panel" hidden><div class="plan-toolbar"><div class="floor-pills"><button data-floor="-1" type="button">院坪</button>${floors.map((f, i) => `<button data-floor="${i}" type="button" class="${i === 0 ? "active" : ""}">${f.name}</button>`).join("")}</div><div class="plan-toolbar-actions"><span id="plan-orient-hint">北 ↑ · 东 →</span><button type="button" id="toggle-wall-width" class="secondary-button" aria-pressed="false" title="显示或隐藏墙厚毫米标注">墙厚</button><button type="button" id="toggle-layout-edit" class="secondary-button" aria-pressed="false">编辑布局</button></div></div><div class="plan-canvas-wrap"><div id="layout-edit-bar" class="layout-edit-bar layout-edit-bar-float" hidden>
        <div class="layout-edit-row">
          <div class="layout-tools" role="toolbar" aria-label="布局编辑类别">
            <button type="button" data-edit-tool="select" class="active">选择</button>
            <button type="button" data-edit-tool="wall">隔墙</button>
            <button type="button" data-edit-tool="room" id="tool-room" aria-expanded="false">房间</button>
            <button type="button" data-edit-tool="door" id="tool-door" aria-expanded="false">门窗</button>
            <button type="button" data-edit-tool="furniture" id="tool-furniture" aria-expanded="false">家具</button>
          </div>
          <div class="layout-edit-actions">
            <span id="layout-save-status" class="layout-save-status" aria-live="polite"></span>
            <button type="button" id="layout-save" class="layout-save-btn">保存</button>
            <button type="button" id="layout-undo">撤销</button>
            <button type="button" id="layout-redo">重做</button>
            <button type="button" id="layout-export">导出定稿 JSON</button>
            <label class="layout-file-button">导入 JSON<input type="file" id="layout-import" accept="application/json,.json"/></label>
            <button type="button" id="layout-reset">恢复正式数据</button>
          </div>
        </div>
      </div><div id="layout-palette" class="layout-palette layout-palette-float" hidden><div class="layout-palette-head"><strong id="layout-palette-label">模型</strong><span class="layout-palette-hint" id="layout-palette-hint">拖到平面图放置；放下后可在图上调方位与大小</span></div><div class="layout-palette-chips" id="layout-palette-chips" role="listbox"></div></div><div class="plan-scroll" id="plan-drawing"></div><div class="plan-zoom-controls" role="group" aria-label="平面图缩放"><button type="button" id="plan-zoom-in" title="放大" aria-label="放大">+</button><button type="button" id="plan-zoom-out" title="缩小" aria-label="缩小">−</button><button type="button" id="plan-zoom-reset" title="复位 100%" aria-label="复位缩放">1×</button><button type="button" id="plan-focus-toggle" title="撑满编辑区域" aria-label="撑满编辑区域" aria-pressed="false">${icon("expand")}</button></div><div id="layout-inspector" class="layout-inspector layout-inspector-float" hidden></div></div></div>
      <article id="sources-panel" class="sources-panel" hidden><h1>设计依据与待核对事项</h1><p class="lead">把已经知道的、照片估算的和设计提出的分开记录，方便家人与现场一起核对。</p><div class="source-gallery">${photos.map((p, i) => `<button data-photo-modal="${i}"><img src="./photos/${p.file}" alt="${p.title}" loading="lazy"/><strong>${p.title}</strong><span>${p.note}</span></button>`).join("")}</div><h2>尺寸与证据</h2><div class="fact-list" id="fact-list"></div><h2>使用范围</h2><p>这是按现有照片与尺寸制作的方案模型。围护墙、楼梯、柱梁、挡土、排水、柴火烟道和邻居平台切除均需结合现场深化；模型没有代替结构施工图，也未认定宅基地审批范围。</p><p>太阳位置采用安化地区坐标和北京时间。周边树高、远山天际线与邻房标高未经测绘，日照结果只用于当前模型内的方案比较。</p><p class="source-links"><a href="https://manuals.lixiang.com/zh-cn/X012022MAX/20250916140616/topic-2022-702D4999-001.html" target="_blank" rel="noreferrer">2022款理想L9官方整车参数 ↗</a><a href="https://bsesc.energy.gov/energy-basics/natural-light-and-daylighting" target="_blank" rel="noreferrer">自然采光与遮阳原理 ↗</a><a href="../sunlight-3d/">原四季日照模拟器 ↗</a></p></article>
      <div class="sun-stamp" id="sun-stamp" hidden>${icon("sun")}<span id="sun-stamp-text"></span></div>
    </section>
    <section id="originals-panel" class="real-scene-panel" aria-label="原始资料" hidden><iframe id="originals-frame" title="原始资料图片与文件浏览"></iframe></section>
    <section id="real-scene-panel" class="real-scene-panel" aria-label="实景效果" aria-description="合成参考，未同步最新方案；尺寸以场地模型为准。" hidden>
      <iframe id="real-scene-frame" title="安化山居实景效果与原片对比" allow="fullscreen"></iframe>
    </section>
    <section id="design-panel" class="design-panel" aria-label="设计沟通资料" hidden></section>
    <aside class="inspector" aria-label="模型设置">
      <div class="scene-heading" id="scene-heading"><h1 id="scene-title">新建方案</h1><p id="scene-subtitle">依据航拍与已知尺寸重建 · 周边为估算</p></div>
      <div id="model-controls">
        <section><h2>方案概览</h2><div class="segmented"><button data-existing="false" class="active" aria-pressed="true">新建</button><button data-existing="true" aria-pressed="false">现状</button></div><div class="area-number" id="area-number">171<span>m²</span></div><p class="area-caption" id="area-caption">主楼 135 m² ＋ 辅楼 36 m²</p><p class="micro" id="area-micro">主体首层投影 · 辅楼前墙内退2米 · 门厅另计 ${buildingAreas.portico.toFixed(1)} m²</p><button type="button" class="secondary-button" id="open-params-from-inspector">打开尺寸设置</button></section>
        <section><h2>模型显示</h2>${check("roof", "屋顶", true)}${check("dimensions", "尺寸标注")}${check("context", "周边环境", true)}${check("main-building", "主楼", true)}${check("annex-building", "辅楼", true)}${check("neighbor-side", "左侧邻居房子", true)}${check("neighbor-rear", "屋后邻居房子", true)}${check("neighbor-front", "前面邻居房子")}${check("neighbor-roadside", "马路边蓝顶邻房", true)}${check("overlap", "主楼与地库重叠")}<label class="select-label">南侧阳台<select id="balcony"><option value="none">无连续后阳台 · 基准</option><option value="local">三楼局部浅阳台 · 1.2 m</option></select></label></section>
        <section><h2>屋面坡度</h2><p class="micro">分水＝水平10对应的升高。主辅楼同步调整，官帽按所选造型重画。</p><div class="range-heading"><label for="fen-shui">分水</label><output id="fen-shui-output">${site.roofFenShui.toFixed(1)}</output></div><input type="range" id="fen-shui" min="1" max="10" step="0.1" value="${site.roofFenShui}"/><label class="select-label">直接输入<input type="number" id="fen-shui-number" min="1" max="10" step="0.1" value="${site.roofFenShui}"/></label><p class="calculation" id="fen-shui-result"></p></section>
        <section><h2>关键尺寸</h2><dl class="metric-list" id="metric-list"></dl></section>
        <button class="notice notice-button" id="open-garage">${icon("info")}<span><strong>地库车辆路线待校核</strong><small>查看车身扫掠、净高待核区与柱墙潜在冲突。<br/>道路与梁底待测，切口协商待确认。</small></span><span>↗</span></button>
      </div>
      <div id="floor-controls" hidden>
        <section><h2>分层户型</h2><div class="segmented"><button data-plan-mode="2d" class="active">平面图</button><button data-plan-mode="3d">立体剖看</button></div><fieldset id="floor-select" class="floor-choices"><legend>选择楼层</legend><div>${floors.map((f, i) => `<label><input type="radio" name="floor" value="${i}" ${i === 0 ? "checked" : ""}/><span><strong>${f.name}</strong><small>${bedroomSummary(i)}</small></span></label>`).join("")}</div></fieldset>${check("explode", "楼层分离展示")}${check("chair-clearance", "餐厅拉椅范围", true)}${check("room-inside", "模型内侧参考尺寸", true)}${check("room-clearance", "家具使用讨论留位")}<label class="select-label">餐厅平面情景<select id="dining-mode"><option value="full">双桌满座 · 18座／偏紧</option><option value="daily">日常建议 · 小桌6座</option></select></label><button class="secondary-button" data-design-issue="D08">记录房间深化意见 ↗</button></section>
        <section><h2 id="floor-summary-title">一层 · 1间卧室＋1间用途待定</h2><p id="floor-summary" class="description"></p><div id="room-detail" class="room-detail" hidden></div></section>
        <section id="dining-check"><h2>餐厅满座</h2><p class="description">圆桌12座＋小桌6座。</p><div class="notice"><span><strong>拉椅空间偏紧</strong><small id="dining-warning"></small></span></div></section>
      </div>
      <div id="sun-controls" hidden>
        <section><h2>四季日照</h2><p class="description">按真实朝北方向观察光线，重点比较南窗与屋后高田的遮挡。</p><div class="season-grid">${[
          ["03-20", "春分"],
          ["06-21", "夏至"],
          ["09-23", "秋分"],
          ["12-22", "冬至"],
        ]
          .map(
            ([date, name]) =>
              `<button data-season="${date}" class="${name === "秋分" ? "active" : ""}">${name}</button>`,
          )
          .join(
            "",
          )}</div><label class="select-label">日期<input type="date" id="sun-date" value="2026-09-23" min="2020-01-01" max="2100-12-31"/></label><div class="range-heading"><label for="sun-time">北京时间</label><output id="time-output">10:30</output></div><input type="range" id="sun-time" min="6" max="18" step="0.25" value="10.5"/><div class="range-ends"><span>06:00</span><span>12:00</span><span>18:00</span></div><dl class="metric-list"><div><dt>太阳高度角</dt><dd id="sun-alt"></dd></div><div><dt>方位角 · 北起顺时针</dt><dd id="sun-az"></dd></div></dl></section>
        <section><h2>后阳台对比</h2><select id="sun-balcony" aria-label="选择南侧阳台方案"><option value="none">无连续后阳台 · 基准</option><option value="local">三楼局部浅阳台 · 1.2 m</option></select><p class="micro">浅阳台仅在三楼公共过厅外，卧室南窗保持开敞。</p><button class="primary-button" id="analyze-sun">计算两种方案的南窗遮挡</button><div id="sun-report" aria-live="polite"></div></section>
        <p class="micro">每半小时采样窗外竖向3点，显示直射光是否受阻；不是室内照度或法定日照时数。树木、邻房和地形为照片估算。</p>
      </div>
      <div id="garage-controls" hidden>
        <section>
          <div class="section-heading"><h2>地库与入口</h2><button id="leave-garage" class="text-button">返回场地</button></div>
          <div class="notice"><span><strong>车辆路线 · 通行未确认</strong><small>道路与最低梁底待测，切口协商待确认；当前仅作模型平面筛查。</small></span></div>
          <dl class="metric-list">
            <div><dt>地库最低净高目标</dt><dd>${site.garageClear.toFixed(2)} m · 待核</dd></div>
            <div><dt>预计入口净宽 · 待测</dt><dd>${garageLayout.entry.d.toFixed(2)} m</dd></div>
            <div><dt>L9长 / 宽 / 高 · 不含镜</dt><dd>${site.vehicle.length} / ${site.vehicle.width} / ${site.vehicle.height} m</dd></div>
            <div><dt>居中直行单侧几何余量</dt><dd>约 ${Math.round((garageLayout.entry.d - site.vehicle.width) * 50)} cm</dd></div>
          </dl><p class="micro">轴距 ${site.vehicle.wheelbase} m，沿用项目已有车辆尺寸。上列余量只是假定入口宽度减车身宽，不含后视镜、转弯及安全余量。</p>
        </section>
        <section><h2>扫掠与风险图层</h2>
          ${check("route-sweep", "车身扫掠范围", true)}${check("route-clearance", "净高待核区与拟切口", true)}${check("route-conflicts", "柱墙与越界提示", true)}
          <ul class="route-legend"><li><i class="route-sweep-key"></i>蓝色：沿途整车占位包络</li><li><i class="route-pending-key"></i>橙色：保留地坪下方 · 净高待测</li><li><i class="route-conflict-key"></i>红色：柱墙投影相交或超出示意通道</li><li><i class="route-cut-key"></i>紫色虚线：拟切口 · 协商待确认</li></ul>
          <p id="route-summary" class="description"></p><div id="route-findings" class="route-findings" aria-label="沿途待核区段，点击定位车辆"></div>
          <p class="micro">平面扫掠包含前后悬；含镜宽、实际转弯、纵坡俯仰、底盘、驶出及两车独立进出待核。</p>
        </section>
        <section><h2>坡道参数探索</h2><p class="micro">院坪暂定±0.000；道路标高与坡长均为待测示意值。</p><label class="select-label">接入处道路标高 · 待测 / 示意（m）<input type="number" id="road-level" value="${surroundings.road.entryY.toFixed(2)}" step="0.1" min="-3.8" max="0"/></label><label class="select-label">坡道投影长度 · 待测 / 示意（m）<input type="number" id="ramp-length" value="5" step="0.5" min="3" max="10"/></label><p class="calculation" id="ramp-result"></p><p class="micro">地库完成面暂${site.garageFloor} m、结构预留${site.deckStructure} m；${site.garageClear} m为净高目标，实际梁底和柱墙待测。</p></section>
        <section><div class="range-heading"><label for="route-progress">车辆沿示意路线移动</label><output id="route-output">0%</output></div><input type="range" id="route-progress" min="0" max="100" value="0" step="1"/><p id="route-status" class="description" aria-live="polite"></p><p class="micro">拖动滑杆或点击待核区段定位车辆。</p></section>
      </div>
      <div id="sources-controls" hidden><section><h2>证据状态</h2><ul class="evidence-legend"><li><i class="e-user"></i>用户提供</li><li><i class="e-photo"></i>照片估算</li><li><i class="e-design"></i>设计建议</li><li><i class="e-pending"></i>待测 / 待校核</li></ul>${check("pending-only", "只看待补测项目")}</section><section><h2>下一步现场补测</h2><ol class="measure-list"><li>道路、邻居院坪与旧房前坪的高差。</li><li>切口、保留柱墙及可用坡道的平面尺寸。</li><li>L9含镜宽、转弯参数。第二辆已按吉利星愿外观示意，不参与通行占位。</li><li>地块转折点、屋后田坎及邻居屋檐位置。</li></ol></section><button class="secondary-button" id="download-data">下载当前方案参数</button></div>
    </aside>
  </main>
  <footer class="app-footer"><span id="interaction-hint">拖动旋转 · 滚轮缩放 · 右键平移</span><span>概念方案 · 待实测与设计</span><a href="#" id="footer-sources">查看数据依据 ↗</a></footer>
  <dialog id="photo-modal"><form method="dialog"><button class="icon-button" aria-label="关闭图片">${icon("close")}</button></form><img id="modal-img" alt="现场参考"/><div><h2 id="modal-title"></h2><p id="modal-note"></p><button id="match-photo" class="secondary-button">按此照片方向观察模型</button></div></dialog>
  <dialog id="export-modal"><form method="dialog"><button class="icon-button" aria-label="关闭导出预览">${icon("close")}</button></form><img id="export-image" alt="当前模型视图导出预览"/><div><h2>当前模型视图</h2><p>图片附版本与未核状态。</p><a id="export-download" class="secondary-button" download="安化山居.png">下载 PNG 图片</a></div></dialog>
  <div id="toast" role="status" hidden></div>
`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let viewer: VillaViewer | null = null;
let review: ReturnType<typeof mountDesignReview> | null = null;
let lastViewingTab: MeetingView["tab"] = "model";
let reviewPose: CameraPose | null = null;
let tab = "model",
  level = 0,
  planMode = "2d",
  photoIndex = 0;
let camera: CameraName = "aerial",
  isExisting = false,
  balcony = false;
let roofStyle: RoofStyle = "joined";
let toastTimer: ReturnType<typeof setTimeout>;
let layoutEditing = false;
let layoutEditor: LayoutEditor | null = null;
let unbindLayoutEditor: (() => void) | null = null;
let unbindCourtyardDims: (() => void) | null = null;
let courtyardDimLayout: CourtyardDimLayout = loadCourtyardDimLayout();
/** 拖放模型时忽略随后的 click，避免误切选中项。 */
let paletteDragActive = false;
let planZoom = 1;
const planZoomMin = 0.5;
const planZoomMax = 3;
const planZoomStep = 0.25;
let showWallWidth = false;
let planEditorFocus = false;

function applyPlanZoom() {
  const scroll = $("plan-drawing");
  scroll.style.setProperty("--plan-zoom", String(planZoom));
  const reset = document.getElementById("plan-zoom-reset");
  if (reset) reset.textContent = `${Math.round(planZoom * 100)}%`;
  const out = document.getElementById("plan-zoom-out") as HTMLButtonElement | null;
  const inn = document.getElementById("plan-zoom-in") as HTMLButtonElement | null;
  if (out) out.disabled = planZoom <= planZoomMin + 1e-6;
  if (inn) inn.disabled = planZoom >= planZoomMax - 1e-6;
  positionLayoutInspector();
}

function syncWallWidthToggle() {
  const btn = document.getElementById("toggle-wall-width");
  if (!btn) return;
  btn.setAttribute("aria-pressed", String(showWallWidth));
  btn.classList.toggle("active", showWallWidth);
}

function setPlanEditorFocus(on: boolean) {
  planEditorFocus = on;
  document.body.classList.toggle("plan-editor-focus", on);
  const btn = document.getElementById("plan-focus-toggle");
  if (btn) {
    btn.setAttribute("aria-pressed", String(on));
    btn.title = on ? "退出撑满（Esc）" : "撑满编辑区域";
    btn.setAttribute("aria-label", on ? "退出撑满编辑区域" : "撑满编辑区域");
    btn.innerHTML = icon(on ? "close" : "expand");
  }
  if (on && tab !== "floor") switchTab("floor");
  if (on && planMode !== "2d") {
    planMode = "2d";
    active("[data-plan-mode]", (b) => b.dataset.planMode === "2d");
    updateScene();
  }
}

function setPlanZoom(next: number, anchor?: { clientX: number; clientY: number }) {
  const scroll = $("plan-drawing");
  const clamped = Math.min(planZoomMax, Math.max(planZoomMin, Math.round(next / planZoomStep) * planZoomStep));
  if (Math.abs(clamped - planZoom) < 1e-6) {
    applyPlanZoom();
    return;
  }
  const before = planZoom;
  // 以指针（或视口中心）为锚，缩放后尽量保持该点仍在视野中。
  const rect = scroll.getBoundingClientRect();
  const cx = anchor ? anchor.clientX - rect.left : rect.width / 2;
  const cy = anchor ? anchor.clientY - rect.top : rect.height / 2;
  const contentX = (scroll.scrollLeft + cx) / before;
  const contentY = (scroll.scrollTop + cy) / before;
  planZoom = clamped;
  applyPlanZoom();
  const applyScroll = () => {
    const maxX = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
    const maxY = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    scroll.scrollLeft = Math.min(maxX, Math.max(0, contentX * planZoom - cx));
    scroll.scrollTop = Math.min(maxY, Math.max(0, contentY * planZoom - cy));
  };
  // 等宽度按 --plan-zoom 重算后再夹紧滚动，避免滚不到左右边缘。
  requestAnimationFrame(applyScroll);
}
function toast(message: string) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("toast").hidden = true;
  }, 3500);
}
function active(selector: string, matches: (button: HTMLElement) => boolean) {
  document.querySelectorAll<HTMLElement>(selector).forEach((b) => {
    const yes = matches(b);
    b.classList.toggle("active", yes);
    b.setAttribute("aria-pressed", String(yes));
  });
}
const checked = (id: string) => $<HTMLInputElement>(id).checked;
const selectedCourtyardFinish = (id: string): CourtyardFinish =>
  parseCourtyardFinish(document.querySelector<HTMLInputElement>(`input[name="${id}-choice"]:checked`)?.value);
function applyCourtyardFinishInputs(own: CourtyardFinish, neighbor: CourtyardFinish) {
  $<HTMLInputElement>(`courtyard-finish-${own}`).checked = true;
  $<HTMLInputElement>(`neighbor-courtyard-finish-${neighbor}`).checked = true;
}
function setSchemeStatus(message: string) {
  const el = document.getElementById("scheme-persist-status");
  if (el) el.textContent = message;
}

let paramsPanelTrigger: HTMLElement | null = null;

/** 把尺寸面板吸附到顶栏「尺寸设置」Tab 正下方。 */
function positionParamsFloat() {
  const panel = document.getElementById("params-float");
  const toggle = document.getElementById("open-params-panel");
  const header = document.querySelector(".app-header");
  if (!panel || panel.hidden || !toggle || !header) return;
  const headerRect = header.getBoundingClientRect();
  const toggleRect = toggle.getBoundingClientRect();
  const margin = 12;
  const preferredWidth = Math.min(810, window.innerWidth - margin * 2);
  // 右对齐吸附在「尺寸设置」按钮下，向左展开以用满宽度
  const right = Math.min(window.innerWidth - margin, toggleRect.right);
  const left = Math.max(margin, right - preferredWidth);
  panel.style.top = `${Math.round(headerRect.bottom)}px`;
  panel.style.left = `${Math.round(left)}px`;
  panel.style.width = `${Math.round(Math.min(preferredWidth, window.innerWidth - left - margin))}px`;
  panel.style.maxHeight = `${Math.round(Math.max(240, window.innerHeight - headerRect.bottom - margin))}px`;
}

function setParamsPanelOpen(open: boolean) {
  const panel = document.getElementById("params-float");
  const toggle = document.getElementById("open-params-panel");
  if (!panel) return;
  if (open) {
    const active = document.activeElement;
    paramsPanelTrigger = active instanceof HTMLElement ? active : toggle;
  }
  panel.hidden = !open;
  if (toggle) {
    toggle.classList.toggle("active", open);
    toggle.setAttribute("aria-pressed", String(open));
  }
  if (open) {
    positionParamsFloat();
    syncVillaParamsWidthSum();
    const firstField = panel.querySelector<HTMLInputElement>("[data-villa-param]");
    firstField?.focus({ preventScroll: true });
  } else {
    paramsPanelTrigger?.focus({ preventScroll: true });
    paramsPanelTrigger = null;
  }
}

function collectSchemeDocument(title = "当前方案", id = "current"): SchemeDocument {
  return buildSchemeDocument({
    id,
    title,
    layoutDraft: loadLayoutDraft(),
    courtyardDimLayout: loadCourtyardDimLayout(),
    roofStyle,
    courtyardFinish: selectedCourtyardFinish("courtyard-finish"),
    neighborCourtyardFinish: selectedCourtyardFinish("neighbor-courtyard-finish"),
  });
}

async function refreshSchemeVersionSelect(index?: SchemeVersionsIndex) {
  const select = document.getElementById("scheme-version-select") as HTMLSelectElement | null;
  if (!select) return;
  const data = index ?? (await loadSchemeVersionsIndex());
  const current = select.value;
  select.innerHTML =
    `<option value="">（当前稿）</option>` +
    data.versions
      .map(
        (v) =>
          `<option value="${escapeHtml(v.file)}">${escapeHtml(v.title)} · ${escapeHtml(v.savedAt.slice(0, 16).replace("T", " "))}</option>`,
      )
      .join("");
  if ([...select.options].some((o) => o.value === current)) select.value = current;
}

async function applySchemeDocument(doc: SchemeDocument, options?: { toastMsg?: string }) {
  replaceCourtyardDimLayout(doc.courtyardDimLayout);
  courtyardDimLayout = loadCourtyardDimLayout();
  replaceLayoutDraftMemory(doc.layoutDraft);
  roofStyle = doc.roofStyle;
  applyCourtyardFinishInputs(doc.courtyardFinish, doc.neighborCourtyardFinish);
  document.querySelectorAll<HTMLButtonElement>("[data-roof-style]").forEach((btn) => {
    const on = btn.dataset.roofStyle === roofStyle;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", String(on));
  });
  await commitVillaParams(doc.villaParams, { persist: false, toastMsg: options?.toastMsg });
  viewer?.setState({
    roofStyle: doc.roofStyle,
    courtyardFinish: doc.courtyardFinish,
    neighborCourtyardFinish: doc.neighborCourtyardFinish,
  });
  updateScene();
  drawPlan();
  setSchemeStatus(`已载入：${doc.title}（${doc.savedAt.slice(0, 19).replace("T", " ")}）`);
}

async function saveSchemeCurrent() {
  const doc = collectSchemeDocument("当前方案", "current");
  const result = await persistSchemeFile("current", doc);
  setSchemeStatus(result.message);
  toast(result.message);
}

async function saveSchemeVersion() {
  const entered = window.prompt("版本名称（可留空用时间戳）", "");
  // Cancel → null；点确定即使空字符串也继续。
  if (entered == null) {
    setSchemeStatus("已取消保存版本");
    return;
  }
  const label = entered.trim();
  const id = makeVersionId();
  const title = label || `版本 ${id}`;
  const doc = collectSchemeDocument(title, id);
  const current = { ...doc, id: "current", title: "当前方案" };
  const index = await loadSchemeVersionsIndex();
  const nextIndex: SchemeVersionsIndex = {
    schema: "anhua-villa-scheme-versions-v1",
    versions: [
      { id, title, savedAt: doc.savedAt, file: `${id}.json` },
      ...index.versions.filter((v) => v.id !== id),
    ],
  };
  // 一次请求写完版本＋目录＋当前稿；静态页则只下一份版本文件。
  const result = await persistSchemeFile({
    kind: "version",
    document: doc,
    current,
    index: nextIndex,
  });
  await refreshSchemeVersionSelect(nextIndex);
  setSchemeStatus(result.message);
  toast(result.message);
}

async function resetSchemeToInitial() {
  const ok = window.confirm("确定恢复默认方案？将还原写死的默认尺寸，并清空布局草稿与院坪标注偏移。不会保存文件。");
  if (!ok) return;
  const doc = resetSchemeDocument();
  clearLayoutDraft();
  clearCourtyardDimLayout();
  courtyardDimLayout = {};
  await applySchemeDocument(doc, { toastMsg: "正在恢复默认方案…" });
  setSchemeStatus("已恢复默认方案（未写入文件）");
  toast("已恢复默认方案");
}
function renderFacts() {
  $("fact-list").innerHTML = facts
    .filter((f) => !checked("pending-only") || f.source === "待测")
    .map(
      (f) =>
        `<div class="fact-row"><div><strong>${f.label}</strong><span class="evidence ${f.source === "用户提供" ? "user" : f.source === "照片估算" ? "photo" : f.source === "设计建议" ? "design" : "pending"}">${f.source}</span></div><b>${f.value}</b><p>${f.note}</p></div>`,
    )
    .join("");
}

function refreshAreaMetrics() {
  const p = getVillaParams();
  const main = buildingAreas.main;
  const annex = buildingAreas.annex;
  const total = main + annex;
  const areaNumber = document.getElementById("area-number");
  if (areaNumber) areaNumber.innerHTML = `${total.toFixed(1)}<span>m²</span>`;
  const caption = document.getElementById("area-caption");
  if (caption) caption.textContent = `主楼 ${main.toFixed(1)} m² ＋ 辅楼 ${annex.toFixed(1)} m²`;
  const micro = document.getElementById("area-micro");
  if (micro) {
    micro.textContent = `主体首层投影 · 辅楼前墙内退${p.annexSetback}米 · 门厅另计 ${buildingAreas.portico.toFixed(1)} m²`;
  }
  const metrics = document.getElementById("metric-list");
  if (metrics) {
    metrics.innerHTML = [
      ["总面宽", `${LOCKED_SITE_WIDTH} m`],
      ["主楼", `${p.mainWidth} × ${p.mainDepth} m`],
      ["辅楼", `${p.annexWidth} × ${p.annexDepth} m · 内退${p.annexSetback} m`],
      ["子孙道", `${p.lane} m`],
      ["三楼北退", `${p.thirdSetback} m`],
      ["门厅外伸", `${p.porticoProjection.toFixed(1)} m`],
      ["二楼前檐", `${p.secondFrontEave.toFixed(2)} m`],
      ["三楼四面檐", `${p.thirdEave.toFixed(2)} m`],
      ["右端人行通道", "约 2 m"],
    ]
      .map(([dt, dd]) => `<div><dt>${dt}</dt><dd>${dd}</dd></div>`)
      .join("");
  }
}

function syncVillaParamsWidthSum() {
  // 只更新合计／校验文案，绝不 fill 回写输入框，否则小数点和光标会被冲掉。
  const params = readVillaParamsFromDom();
  updateVillaParamsMeta(params);
  const issues = validateVillaParams(params);
  const err = document.getElementById("villa-params-error");
  const applyBtn = document.getElementById("villa-params-apply") as HTMLButtonElement | null;
  if (err) {
    if (issues.length) {
      err.hidden = false;
      err.textContent = issues.map((i) => i.message).join("；");
    } else {
      err.hidden = true;
      err.textContent = "";
    }
  }
  if (applyBtn) applyBtn.disabled = issues.length > 0;
}

function syncFenShuiInputs(value: number) {
  for (const id of ["fen-shui", "fen-shui-number"]) {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.value = String(value);
  }
  const out = document.getElementById("fen-shui-output");
  if (out) out.textContent = String(Math.round(value * 10) / 10);
}

function rescaleStoredLayoutDraft() {
  const draft = loadLayoutDraft();
  if (!draft) return false;
  const next = scaleLayoutDraftToEnvelope(draft, envelopeFromSite());
  saveLayoutDraft(next);
  return true;
}

function paintFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

async function withVillaParamsBusy(message: string, work: () => void) {
  const section = document.getElementById("villa-params-section");
  const applyBtn = document.getElementById("villa-params-apply") as HTMLButtonElement | null;
  const actionBtns = [
    applyBtn,
    document.getElementById("villa-params-reset"),
    document.getElementById("scheme-save-current"),
    document.getElementById("scheme-save-version"),
    document.getElementById("scheme-load-version"),
  ].filter((el): el is HTMLButtonElement => el instanceof HTMLButtonElement);
  const busy = document.getElementById("villa-params-busy");
  const applyLabel = applyBtn?.textContent ?? "应用参数";
  section?.classList.add("is-busy");
  if (busy) {
    busy.hidden = false;
    busy.textContent = message;
  }
  for (const btn of actionBtns) btn.disabled = true;
  if (applyBtn) applyBtn.textContent = "重建中…";
  await paintFrame();
  try {
    work();
    await paintFrame();
  } finally {
    section?.classList.remove("is-busy");
    if (busy) busy.hidden = true;
    for (const btn of actionBtns) btn.disabled = false;
    if (applyBtn) {
      applyBtn.textContent = applyLabel;
      applyBtn.disabled = validateVillaParams(readVillaParamsFromDom()).length > 0;
    }
  }
}

async function commitVillaParams(params: VillaParams, options?: { persist?: boolean; toastMsg?: string }) {
  const issues = validateVillaParams(params);
  if (issues.length) {
    const err = document.getElementById("villa-params-error");
    if (err) {
      err.hidden = false;
      err.textContent = issues.map((i) => i.message).join("；");
    }
    toast(issues[0]?.message ?? "参数未通过校验");
    return false;
  }
  let draftRescaled = false;
  await withVillaParamsBusy(options?.toastMsg?.includes("恢复") ? "正在恢复方案尺寸…" : "正在应用方案尺寸…", () => {
    const wasEditing = layoutEditing;
    if (wasEditing) setLayoutEditing(false);
    applyVillaParams(params);
    const applied = getVillaParams();
    if (options?.persist !== false) saveVillaParams(applied);
    fillVillaParamsDom(applied, document, { force: true });
    syncFenShuiInputs(applied.roofFenShui);
    const pitched = roofPitch(params.roofFenShui);
    $("fen-shui-result").textContent =
      `主楼升高 ${pitched.mainRise.toFixed(2)} m，半坡 ${pitched.mainRun.toFixed(2)} m。辅楼升高 ${pitched.annexRise.toFixed(2)} m，半坡 ${pitched.annexRun.toFixed(2)} m。`;
    draftRescaled = rescaleStoredLayoutDraft();
    viewer?.rebuildAfterParams(params.roofFenShui);
    refreshAreaMetrics();
    updateScene();
    drawPlan();
    syncVillaParamsWidthSum();
  });
  toast(
    options?.toastMsg ??
      (draftRescaled ? "已应用方案尺寸；布局草稿已随方案参数重算" : "已应用方案尺寸"),
  );
  return true;
}
function parseLayoutNumber(raw: string): number | null {
  const text = raw.trim().replace(/[，．。]/g, ".").replace(/[^\d.\-]/g, "");
  if (!text || text === "-" || text === "." || text === "-.") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function refreshLayoutInspector() {
  const panel = $("layout-inspector");
  if (!layoutEditor || !layoutEditing || !layoutEditor.selection) {
    panel.innerHTML = "";
    panel.hidden = true;
    return;
  }
  // 仅在有选中对象时展示属性条，避免空提示占高度
  panel.innerHTML = layoutEditor.inspectorHtml();
  panel.hidden = false;
  positionLayoutInspector();
}

/** 参数框贴着当前选中模型；优先右侧，空间不够再左侧／下方。 */
function positionLayoutInspector() {
  const panel = $("layout-inspector");
  if (panel.hidden) return;
  const wrap = document.querySelector<HTMLElement>(".plan-canvas-wrap");
  if (!wrap) return;
  const place = () => {
    if (panel.hidden || wrap.offsetWidth < 8) return;
    const marks = wrap.querySelectorAll(".edit-selection");
    const wrapRect = wrap.getBoundingClientRect();
    const gap = 10;
    const pw = panel.offsetWidth;
    const ph = panel.offsetHeight;
    if (pw < 8 || ph < 8) return;
    let left = wrapRect.width - pw - 12;
    let top = 12;
    if (marks.length) {
      let minL = Infinity;
      let minT = Infinity;
      let maxR = -Infinity;
      let maxB = -Infinity;
      marks.forEach((el) => {
        const r = el.getBoundingClientRect();
        minL = Math.min(minL, r.left);
        minT = Math.min(minT, r.top);
        maxR = Math.max(maxR, r.right);
        maxB = Math.max(maxB, r.bottom);
      });
      const selL = minL - wrapRect.left;
      const selT = minT - wrapRect.top;
      const selR = maxR - wrapRect.left;
      const selB = maxB - wrapRect.top;
      left = selR + gap;
      top = selT;
      if (left + pw > wrapRect.width - 8) left = selL - gap - pw;
      if (left < 8) {
        left = Math.max(8, Math.min(selL, wrapRect.width - pw - 8));
        top = selB + gap;
      }
    }
    // 避开顶栏吸附的操作条／模型面板
    let chromeBottom = 8;
    for (const id of ["layout-edit-bar", "layout-palette"] as const) {
      const el = document.getElementById(id);
      if (!el || el.hidden) continue;
      const r = el.getBoundingClientRect();
      chromeBottom = Math.max(chromeBottom, r.bottom - wrapRect.top + 8);
    }
    const minTop = chromeBottom;
    top = Math.max(minTop, Math.min(top, Math.max(minTop, wrapRect.height - ph - 8)));
    left = Math.max(8, Math.min(left, Math.max(8, wrapRect.width - pw - 8)));
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  };
  requestAnimationFrame(place);
}

/** 把编辑条实高写入 CSS 变量，模型面板才能贴齐其下沿。 */
function syncLayoutChromeHeight() {
  const wrap = document.querySelector<HTMLElement>(".plan-canvas-wrap");
  const bar = document.getElementById("layout-edit-bar");
  if (!wrap) return;
  const h = bar && !bar.hidden ? Math.ceil(bar.getBoundingClientRect().height) : 0;
  wrap.style.setProperty("--layout-edit-bar-h", `${h || 48}px`);
}

function syncLayoutPalette() {
  const palette = $("layout-palette");
  const chips = $("layout-palette-chips");
  const label = $("layout-palette-label");
  const hint = $("layout-palette-hint");
  const setExpanded = (id: string, on: boolean) => {
    const btn = document.getElementById(id);
    if (btn) btn.setAttribute("aria-expanded", String(on));
  };
  setExpanded("tool-room", false);
  setExpanded("tool-door", false);
  setExpanded("tool-furniture", false);
  if (!layoutEditing || !layoutEditor) {
    palette.hidden = true;
    syncLayoutChromeHeight();
    return;
  }
  const tool = layoutEditor.tool;
  const show = tool === "room" || tool === "door" || tool === "furniture";
  palette.hidden = !show;
  active("[data-edit-tool]", (b) => b.dataset.editTool === tool);
  if (!show) {
    chips.replaceChildren();
    requestAnimationFrame(syncLayoutChromeHeight);
    return;
  }
  let category = "room";
  let items: { value: string; text: string; active: boolean }[] = [];
  if (tool === "room") {
    category = "room";
    label.textContent = "房间";
    hint.textContent = "拖到平面图放置房间框；放下后拖四角改大小";
    setExpanded("tool-room", true);
    items = roomKindOptions.map(([value, text]) => ({
      value,
      text,
      active: layoutEditor!.roomKind === value,
    }));
  } else if (tool === "door") {
    category = "door";
    label.textContent = "门窗";
    hint.textContent = "拖到隔墙或外墙附近；放下后可改开向、宽度";
    setExpanded("tool-door", true);
    items = OPENING_KINDS.map((value) => ({
      value,
      text: openingLabels[value],
      active: layoutEditor!.openingKind === value,
    }));
  } else {
    category = "furniture";
    label.textContent = "家具";
    hint.textContent = "拖到平面图放置；放下后拖四角缩放、拖蓝点旋转";
    setExpanded("tool-furniture", true);
    items = furniturePickerOrder.map((value) => ({
      value,
      text: furnitureLabels[value],
      active: layoutEditor!.furnitureKind === value,
    }));
  }
  chips.innerHTML = items
    .map(
      (item) =>
        `<button type="button" role="option" class="layout-chip${item.active ? " active" : ""}" draggable="true" data-palette-category="${category}" data-palette-kind="${item.value}" aria-selected="${item.active}" title="拖到平面图放置">${item.text}</button>`,
    )
    .join("");
  requestAnimationFrame(syncLayoutChromeHeight);
}
function drawPlan() {
  unbindLayoutEditor?.();
  unbindLayoutEditor = null;
  unbindCourtyardDims?.();
  unbindCourtyardDims = null;
  const sitePlan = level < 0;
  if (sitePlan && layoutEditing) layoutEditing = false;

  if (sitePlan) {
    $("plan-drawing").innerHTML = courtyardSitePlan(courtyardDimLayout);
    syncWallWidthToggle();
    active("[data-floor]", (b) => Number(b.dataset.floor) === level);
    document.querySelectorAll<HTMLInputElement>('input[name="floor"]').forEach((input) => {
      input.checked = false;
    });
    $("floor-summary-title").textContent = "院坪 · 自家与邻居总图";
    $("floor-summary").textContent =
      "只画主楼、辅楼、过道与门厅外轮廓，不画室内布局。尺寸线可拖：黄点固定在被量边上，虚线可拉长或翻到另一侧，文字紧贴尺寸线；位置记在本浏览器。外沿按口述三点过圆：东界总进深19.4、中约15.8、西端11（均含屋后到水泥边10.8）。辅楼前墙内退1米。邻居占位面宽13、进深10.8，水泥外院坪北缘与自家东界外沿齐平、不再北伸。待现场复核。";
    $("room-detail").hidden = true;
    $("room-detail").replaceChildren();
    $("dining-check").hidden = true;
    $("layout-edit-bar").hidden = true;
    $("toggle-layout-edit").hidden = true;
    $("toggle-wall-width").hidden = true;
    $("toggle-layout-edit").setAttribute("aria-pressed", "false");
    $("toggle-layout-edit").classList.remove("active");
    $("toggle-layout-edit").textContent = "编辑布局";
    syncLayoutPalette();
    const courtyardSvg = $("plan-drawing").querySelector("svg.courtyard-site-svg") as SVGSVGElement | null;
    if (courtyardSvg) {
      unbindCourtyardDims = bindCourtyardDimDrag(
        courtyardSvg,
        () => courtyardDimLayout,
        (next) => {
          courtyardDimLayout = next;
        },
      );
    }
    requestAnimationFrame(() => {
      syncLayoutChromeHeight();
      positionLayoutInspector();
    });
    const orient = document.getElementById("plan-orient-hint");
    if (orient) orient.title = "院坪总图 · 北向上，东向右 · 尺寸线可拖 · 左右按面对房子";
    refreshLayoutInspector();
    applyPlanZoom();
    return;
  }

  $("toggle-layout-edit").hidden = false;
  $("toggle-wall-width").hidden = false;

  const source = layoutEditing && layoutEditor
    ? planSourceFromDraft(layoutEditor.draft, level)
    : planSourceFromPublished(level);
  const selected = layoutEditing && layoutEditor?.selection
    ? layoutEditor.selection.kind === "room"
      ? { kind: "room", id: layoutEditor.selection.id }
      : layoutEditor.selection.kind === "furniture"
        ? { kind: "furniture", index: layoutEditor.selection.index }
        : layoutEditor.selection.kind === "door"
          ? {
              kind: "door",
              index: layoutEditor.selection.index,
              annex: layoutEditor.selection.annex,
              exterior: layoutEditor.selection.exterior,
            }
          : layoutEditor.selection.kind === "wall"
            ? {
                kind: "wall",
                index: layoutEditor.selection.index,
                annex: layoutEditor.selection.annex,
              }
            : { kind: layoutEditor.selection.kind }
    : null;
  const selectedFurniture =
    layoutEditing && layoutEditor
      ? layoutEditor.selections
          .filter((s): s is Extract<typeof s, { kind: "furniture" }> => s.kind === "furniture" && s.floor === level)
          .map((s) => s.index)
      : [];
  const selectedRooms =
    layoutEditing && layoutEditor
      ? layoutEditor.selections
          .filter((s): s is Extract<typeof s, { kind: "room" }> => s.kind === "room" && s.floor === level)
          .map((s) => s.id)
      : [];
  $("plan-drawing").innerHTML = floorPlan(
    level,
    checked("chair-clearance"),
    balcony,
    {
      inside: checked("room-inside"),
      useZones: checked("room-clearance"),
      dining: $<HTMLSelectElement>("dining-mode").value as "full" | "daily",
      editable: layoutEditing,
      selected,
      selectedFurniture,
      selectedRooms,
      showWallWidth,
      drawGuide: layoutEditing ? layoutEditor?.getDrawGuide() ?? null : null,
      alignGuide: layoutEditing ? layoutEditor?.getAlignGuide() ?? null : null,
    },
    source,
  );
  syncWallWidthToggle();
  active("[data-floor]", (b) => Number(b.dataset.floor) === level);
  document.querySelectorAll<HTMLInputElement>('input[name="floor"]').forEach(input => {
    input.checked = Number(input.value) === level;
  });
  $("floor-summary-title").textContent =
    `${floors[level].name} · ${bedroomSummary(level)}`;
  $("floor-summary").textContent = layoutEditing
    ? "编辑草稿中。外墙锁定；房间、隔墙、门洞、家具、楼梯和门厅可拖。定稿后导出 JSON，再回写模型。"
    : [
    "面对房子时，右侧是挑空客厅，左侧前部是 4.5×3 米茶室，茶室和尊亲房中间是楼梯。尊亲房靠南，带内卫。右后是一间用途待定的房间。堂屋后面只留空位。辅楼厨房未改。",
    "挑空仍在右侧。茶室上方是一间 3 米进深的东前卧室；主卧改到楼梯南侧，带内卫。西侧另有一间卧室。楼梯和公卫与一楼对齐。",
    "中间仍是家庭多功能厅。西侧前为主卧，后部是影音室。东侧楼梯与下面对齐，楼梯北是通东侧露台的过厅，南侧是卧室和内卫。",
  ][level];
  $("room-detail").hidden = true;
  $("room-detail").replaceChildren();
  $("dining-check").hidden = level !== 0 || layoutEditing;
  $("layout-edit-bar").hidden = !layoutEditing;
  $("toggle-layout-edit").setAttribute("aria-pressed", String(layoutEditing));
  $("toggle-layout-edit").classList.toggle("active", layoutEditing);
  $("toggle-layout-edit").textContent = layoutEditing ? "退出编辑" : "编辑布局";
  syncLayoutPalette();
  requestAnimationFrame(() => {
    syncLayoutChromeHeight();
    positionLayoutInspector();
  });
  const orient = document.getElementById("plan-orient-hint");
  if (orient) {
    orient.title = layoutEditing
      ? "编辑：⌘S 暂存内存 · 改完请「保存到文件／版本」· Shift 多选 · 方向键微调"
      : level === 0 && $<HTMLSelectElement>("dining-mode").value === "daily"
        ? "日常6座示意；尺寸与留位仅作模型参考"
        : "外轮廓／内侧参考未扣装修；北向上，东向右";
  }
  refreshLayoutInspector();
  if (layoutEditing && layoutEditor) {
    const svg = $("plan-drawing").querySelector("svg.floor-svg");
    if (svg) {
      svg.classList.toggle("tool-wall", layoutEditor.tool === "wall");
      svg.classList.toggle("tool-room", layoutEditor.tool === "room");
      svg.classList.toggle("tool-door", layoutEditor.tool === "door");
      svg.classList.toggle("tool-furniture", layoutEditor.tool === "furniture");
      unbindLayoutEditor = layoutEditor.bind(svg as SVGSVGElement);
    }
  }
  applyPlanZoom();
}
function formatSaveStatus(updatedAt: string, manual: boolean) {
  const t = new Date(updatedAt);
  const clock = Number.isNaN(t.getTime())
    ? ""
    : `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}:${String(t.getSeconds()).padStart(2, "0")}`;
  return manual ? `已写入内存 ${clock} · 请「保存到文件」` : `已暂存 ${clock} · 请「保存到文件」`;
}

function setLayoutSaveStatus(updatedAt: string, manual: boolean) {
  const el = document.getElementById("layout-save-status");
  if (el) el.textContent = formatSaveStatus(updatedAt, manual);
}

function setLayoutEditing(on: boolean) {
  if (on && level < 0) {
    toast("院坪总图不支持编辑布局，请先切换到一层／二层／三楼");
    return;
  }
  if (on && planMode !== "2d") {
    planMode = "2d";
    active("[data-plan-mode]", (b) => b.dataset.planMode === "2d");
  }
  layoutEditing = on;
  if (on && !layoutEditor) {
    layoutEditor = new LayoutEditor({
      getFloor: () => level,
      redraw: () => drawPlan(),
      toast,
      onDraftSaved: setLayoutSaveStatus,
    });
  } else if (on && layoutEditor) {
    setLayoutSaveStatus(layoutEditor.draft.updatedAt, false);
  }
  if (!on) {
    const el = document.getElementById("layout-save-status");
    if (el) el.textContent = "";
  }
  updateScene();
}
function updateScene() {
  const design = tab === "design";
  const originals = tab === "originals";
  const realScene = tab === "real";
  // 页脚保留；画布下说明条已去掉。撑满编辑区时仍隐藏页脚。
  document.querySelector<HTMLElement>(".app-footer")!.hidden =
    design || realScene || originals || tab === "sources" || planEditorFocus;
  document.body.classList.toggle(
    "focused-view",
    design || realScene || originals || tab === "sources" || planEditorFocus,
  );
  $("design-panel").hidden = !design;
  $("real-scene-panel").hidden = !realScene;
  $("originals-panel").hidden = !originals;
  document.querySelector<HTMLElement>(".stage")!.hidden = realScene || design || originals;
  document.querySelector<HTMLElement>(".inspector")!.hidden = realScene || design || originals;
  if (design) {
    $("loading").hidden = true;
    $("interaction-hint").textContent = "按编号记录意见 · 保存快照与JSON备份 · 导出离线沟通图册";
    review?.refresh();
    return;
  }
  if (originals) {
    const frame = $<HTMLIFrameElement>("originals-frame");
    if (!frame.hasAttribute("src")) frame.src = "../original-materials/";
    return;
  }
  if (realScene) {
    const frame = $<HTMLIFrameElement>("real-scene-frame");
    if (!frame.hasAttribute("src")) frame.src = "../villa-real-scene/?embed=1&ui=11";
    $("interaction-hint").textContent = "切换机位 · 原片对比 · 下载实景效果";
    return;
  }
  const garage = tab === "model" && camera === "garage";
  if (tab === "floor" && planMode === "3d" && level < 0) level = 0;
  const floor3d = tab === "floor" && planMode === "3d";
  const plan = tab === "floor" && planMode === "2d";
  if (plan || tab === "sources") $("loading").hidden = true;
  $("viewport").hidden = plan || tab === "sources";
  $("plan-panel").hidden = !plan;
  $("sources-panel").hidden = tab !== "sources";
  $("scene-heading").hidden = plan || tab === "sources";
  $("scene-tools").hidden = plan || tab === "sources";
  $("compass").hidden = plan || tab === "sources";
  $("photo-strip").hidden = tab !== "model" || garage;
  $("camera-bar").hidden = tab === "sources" || tab === "floor";
  $("sun-stamp").hidden = tab !== "sun";
  document.querySelector<HTMLElement>('[data-camera="garage"]')!.hidden =
    tab === "sun";
  $<HTMLInputElement>("roof").disabled = isExisting && tab === "model";
  $<HTMLSelectElement>("balcony").disabled = isExisting && tab === "model";
  for (const p of ["model", "floor", "sun", "garage", "sources"])
    $(`${p}-controls`).hidden =
      p === "model"
        ? tab !== "model" || garage
        : p === "garage"
          ? !garage
          : tab !== p;
  if (tab !== "model") $("comparison").hidden = true;
  viewer?.setState({
    roofStyle,
    courtyardFinish: selectedCourtyardFinish("courtyard-finish"),
    neighborCourtyardFinish: selectedCourtyardFinish("neighbor-courtyard-finish"),
    existing: isExisting && tab === "model",
    roof: checked("roof"),
    dimensions: checked("dimensions"),
    context: checked("context"),
    balcony,
    floor: floor3d ? level : null,
    exploded: floor3d && checked("explode"),
    garage,
    overlap: checked("overlap"),
    mainBuilding: checked("main-building"),
    annexBuilding: checked("annex-building"),
    sideNeighbor: checked("neighbor-side"),
    rearNeighbor: checked("neighbor-rear"),
    frontNeighbor: checked("neighbor-front"),
    roadsideNeighbor: checked("neighbor-roadside"),
  });
  active("[data-roof-style]", b => b.dataset.roofStyle === roofStyle);
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-roof-style]"))
    button.disabled = isExisting && tab === "model";
  $("roof-style-note").textContent = isExisting && tab === "model"
    ? "切换到新建方案，可比较两种官帽造型。"
    : roofStyle === "floating"
      ? "默认帽顶低于主脊50cm，纵脊接入正屋，檐底贴近屋面。"
      : "官帽与正屋同脊高，檐口相连。";
  $("scene-title").textContent = garage
    ? "地库车辆路线与待核区"
    : floor3d
      ? `${floors[level].name} · 立体剖看`
      : tab === "sun"
        ? "南侧日照与遮挡"
        : isExisting
          ? "老房现状"
          : "新建方案";
  $("scene-subtitle").textContent = garage
    ? "车身平面扫掠 · 净高待测 · 切口协商待确认"
    : floor3d
      ? checked("explode")
        ? "楼层竖向分离展示 · 不改变实际层高"
        : "显示本层与真实门窗 · 其他楼层隐藏"
      : "依据航拍与已知尺寸重建 · 周边为估算";
  $("interaction-hint").textContent = plan
    ? "点击房间查看说明 · 小屏可横向滚动图纸"
    : "拖动旋转 · 滚轮缩放 · 右键平移";
  if (tab === "floor") drawPlan();
}
function switchTab(name: string) {
  const resumePose = tab === "design" && name === lastViewingTab ? reviewPose : null;
  if (name === "design" && tab !== "design") reviewPose = viewer?.cameraPose() ?? null;
  tab = name;
  if (name !== "floor" && planEditorFocus) setPlanEditorFocus(false);
  if (name === "model" || name === "floor" || name === "sun") lastViewingTab = name;
  active("[data-tab]", (b) => b.dataset.tab === tab);
  if (tab === "real" || tab === "design" || tab === "originals") {
    updateScene();
    return;
  }
  if (tab === "floor") {
    updateScene();
    if (planMode === "3d" && !checked("explode")) viewer?.setCamera("top");
  } else {
    if (tab === "sun") camera = "south";
    if (tab === "model" && camera === "top") camera = "aerial";
    updateScene();
    viewer?.setCamera(camera);
  }
  active("[data-camera]", (b) => b.dataset.camera === camera);
  if (resumePose) viewer?.restoreCameraPose(resumePose);
}
function setCamera(name: CameraName) {
  camera = name;
  if (name === "garage") {
    isExisting = false;
    active("[data-existing]", (b) => b.dataset.existing === "false");
  }
  updateScene();
  viewer?.setCamera(name);
  active("[data-camera]", (b) => b.dataset.camera === name);
}
function timeText(hour: number) {
  return `${String(Math.floor(hour)).padStart(2, "0")}:${String(Math.round((hour % 1) * 60)).padStart(2, "0")}`;
}
function updateSun() {
  const date = $<HTMLInputElement>("sun-date").value,
    hour = Number($<HTMLInputElement>("sun-time").value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const pos = viewer?.setSun(date, hour);
  $("time-output").textContent = timeText(hour);
  $("sun-stamp-text").textContent = `${date}　${timeText(hour)}　北京时间`;
  if (pos) {
    $("sun-alt").textContent = `${pos.altitude.toFixed(1)}°`;
    $("sun-az").textContent = `${pos.azimuth.toFixed(1)}°`;
  }
  active("[data-season]", (b) => date.endsWith(b.dataset.season!));
}
function updateFenShui(source?: HTMLInputElement) {
  const range = $<HTMLInputElement>("fen-shui");
  const field = $<HTMLInputElement>("fen-shui-number");
  const current = source ?? field;
  const value = Number(current.value);
  if (!current.value || !Number.isFinite(value) || value < 1 || value > 10) {
    $("fen-shui-result").textContent = "请输入 1 到 10 之间的分水。";
    return;
  }
  (current === range ? field : range).value = current.value;
  $("fen-shui-output").textContent = String(Math.round(value * 10) / 10);
  const pitch = roofPitch(value);
  $("fen-shui-result").textContent =
    `主楼升高 ${pitch.mainRise.toFixed(2)} m，半坡 ${pitch.mainRun.toFixed(2)} m。辅楼升高 ${pitch.annexRise.toFixed(2)} m，半坡 ${pitch.annexRun.toFixed(2)} m。`;
  viewer?.setRoofFenShui(value);
  const fenInput = document.querySelector<HTMLInputElement>('[data-villa-param="roofFenShui"]');
  if (fenInput) fenInput.value = String(value);
  const next = { ...getVillaParams(), roofFenShui: value };
  rememberVillaParams(next);
  saveVillaParams(next);
}
function updateRamp() {
  const roadY = Number($<HTMLInputElement>("road-level").value),
    len = Number($<HTMLInputElement>("ramp-length").value);
  if (
    !$<HTMLInputElement>("road-level").value ||
    !Number.isFinite(roadY) ||
    roadY < -3.8 ||
    roadY > 0 ||
    !Number.isFinite(len) ||
    len < 3 ||
    len > 10
  ) {
    $("ramp-result").textContent =
      "请输入有效范围：道路−3.8～0米，坡长3～10米。图中沿用上次有效的示意参数。";
    return;
  }
  viewer?.updateRamp(roadY, len);
  const grade = ((roadY - site.garageFloor) / len) * 100;
  $("ramp-result").textContent =
    `示意高差 ${Math.abs(roadY - site.garageFloor).toFixed(2)} m / ${len.toFixed(1)} m → ${grade >= 0 ? "下坡" : "上坡"} ${Math.abs(grade).toFixed(1)}%`;
  renderRouteReview();
  updateRoute();
}
function renderRouteReview() {
  if (!viewer) return;
  const assessment = viewer.routeAssessment;
  const columns = assessment.conflicts.filter((o) => o.kind === "column");
  const walls = [...new Set(assessment.conflicts.filter((o) => o.kind === "wall").map((o) => o.label))];
  $("route-summary").textContent =
    `全程平面筛查：${columns.length ? `${columns.length}根模型柱有投影潜在冲突` : "未见模型柱投影相交"}；${walls.length ? `${walls.length}处墙体有投影潜在冲突` : "未见模型墙体投影相交"}。道路与梁底标高待测，通行未确认。点击下列区段定位查看。`;
  const findings = $("route-findings");
  findings.replaceChildren();
  const add = (label: string, kind: string, predicate: (cell: SweepCell) => boolean) => {
    const ranges = routeRanges(assessment.cells, predicate);
    if (!ranges.length) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "route-finding";
    button.dataset.kind = kind;
    button.dataset.routeTo = String(Math.round((ranges[0][0] + ranges[0][1]) * 50));
    const name = document.createElement("strong"), range = document.createElement("small");
    name.textContent = label;
    range.textContent = `${formatRouteRanges(ranges)} · 点击定位`;
    button.append(name, range);
    findings.append(button);
  };
  add("保留地坪下方 · 净高待测", "pending", (c) => c.underDeck);
  add("越出示意通道 · 需复核", "conflict", (c) => c.outside);
  for (const o of columns)
    add(`${o.label} · 平面潜在冲突`, "conflict", (c) => c.obstacles.includes(o));
  for (const wall of walls)
    add(`${wall} · 平面潜在冲突`, "conflict", (c) => c.obstacles.some((o) => o.label === wall));
}
function updateRoute() {
  const n = Number($<HTMLInputElement>("route-progress").value);
  $("route-output").textContent = `${n}%`;
  const result = viewer?.routeAt(n);
  if (result) {
    $("route-status").textContent = result.note;
    $("route-status").dataset.kind = result.outside || result.obstacles.length ? "conflict" : "pending";
  }
}
function showRoom(id: string) {
  if (layoutEditing) return;
  const room = [...floors[level].rooms, ...(level === 0 ? annexRooms : [])].find((r) => r.id === id);
  if (!room) return;
  const ref = roomReference(room, level);
  $("room-detail").hidden = false;
  $("room-detail").innerHTML = `<strong>${escapeHtml(room.name)}</strong><p>${room.w.toFixed(2)} × ${room.d.toFixed(2)} m · 外轮廓</p>${room.kind !== "void" ? `<p>模型内侧参考约 ${ref.w.toFixed(2)} × ${ref.d.toFixed(2)} m</p><p class="micro">${escapeHtml(ref.note)}</p>` : ""}<p>${escapeHtml(room.note ?? "家具与空间为方案参考，需结合结构、装修和使用进一步深化。")}</p>${room.purposeStatus ? "<p>用途待确认；当前不计入6间用途明确的卧室。</p>" : ""}<button class="text-button" data-design-issue="${room.id === "dining" ? "D09" : room.id === "stair" ? "D03" : room.id === "spare" ? "D10" : "D08"}">打开相关议题与记录 ↗</button>`;
}
function captureMeetingView(): MeetingView {
  return {
    roofStyle,
    courtyardFinish: selectedCourtyardFinish("courtyard-finish"),
    neighborCourtyardFinish: selectedCourtyardFinish("neighbor-courtyard-finish"),
    tab: ["model", "floor", "sun"].includes(tab) ? tab as MeetingView["tab"] : lastViewingTab,
    camera: viewer?.activeCamera ?? camera,
    level, planMode: planMode as "2d" | "3d", existing: viewer?.state.existing ?? (isExisting && lastViewingTab === "model"), balcony,
    fenShui: Number($<HTMLInputElement>("fen-shui").value),
    roadY: viewer?.roadY ?? surroundings.road.entryY, rampLength: viewer?.rampLength ?? 5,
    progress: Number($<HTMLInputElement>("route-progress").value),
    sunDate: $<HTMLInputElement>("sun-date").value, sunTime: Number($<HTMLInputElement>("sun-time").value),
    dining: $<HTMLSelectElement>("dining-mode").value as "full" | "daily",
    flags: Object.fromEntries(viewFlags.map((id) => [id, checked(id)])),
    pose: viewer?.cameraPose() ?? null,
    villaParams: getVillaParams(),
  };
}
function restoreMeetingView(view: MeetingView) {
  level = view.level; planMode = view.planMode; isExisting = view.existing; balcony = view.balcony; camera = view.camera;
  roofStyle = view.roofStyle;
  $<HTMLInputElement>(`courtyard-finish-${view.courtyardFinish}`).checked = true;
  $<HTMLInputElement>(`neighbor-courtyard-finish-${view.neighborCourtyardFinish}`).checked = true;
  for (const id of viewFlags) $<HTMLInputElement>(id).checked = view.flags[id];
  const params = { ...DEFAULT_VILLA_PARAMS, ...view.villaParams, roofFenShui: view.fenShui };
  void commitVillaParams(params, { persist: true, toastMsg: "已恢复会议快照中的方案尺寸" });
  $<HTMLInputElement>("road-level").value = String(view.roadY);
  $<HTMLInputElement>("ramp-length").value = String(view.rampLength);
  $<HTMLInputElement>("route-progress").value = String(view.progress);
  $<HTMLInputElement>("sun-date").value = view.sunDate;
  $<HTMLInputElement>("sun-time").value = String(view.sunTime);
  $<HTMLSelectElement>("dining-mode").value = view.dining;
  for (const id of ["balcony", "sun-balcony"]) $<HTMLSelectElement>(id).value = balcony ? "local" : "none";
  active("[data-existing]", (b) => b.dataset.existing === String(isExisting));
  active("[data-plan-mode]", (b) => b.dataset.planMode === planMode);
  updateRamp(); updateSun();
  switchTab(view.tab);
  camera = view.camera;
  viewer?.setCamera(view.camera);
  if (view.pose) viewer?.restoreCameraPose(view.pose);
  viewer?.setRouteLayers({ sweep: view.flags["route-sweep"], clearance: view.flags["route-clearance"], conflicts: view.flags["route-conflicts"] });
  active("[data-camera]", (b) => b.dataset.camera === camera);
}
function locateDesignIssue(issue: DesignIssue) {
  if (issue.target === "real" || issue.target === "sources" || issue.target === "sun") {
    switchTab(issue.target);
  } else if (["floor", "stair", "roof"].includes(issue.target)) {
    level = issue.floor ?? (issue.target === "roof" ? 2 : 0);
    planMode = "2d";
    active("[data-plan-mode]", (b) => b.dataset.planMode === "2d");
    $<HTMLInputElement>("room-clearance").checked = issue.target === "floor";
    switchTab("floor");
    if (issue.room) {
      showRoom(issue.room);
      document.querySelectorAll<HTMLElement>("[data-room]").forEach((r) => r.classList.toggle("selected", r.dataset.room === issue.room));
    }
  } else {
    isExisting = false;
    active("[data-existing]", (b) => b.dataset.existing === "false");
    switchTab("model");
    setCamera(issue.target === "garage" ? "garage" : issue.target === "entrance" ? "courtyard" : "aerial");
  }
  toast(`${issue.id} · ${issue.title}；可返回设计沟通记录意见。`);
}
function openPhoto(index: number, modal = false) {
  photoIndex = index;
  const p = photos[index];
  if (modal) {
    $<HTMLImageElement>("modal-img").src = `./photos/${p.file}`;
    $<HTMLImageElement>("modal-img").alt = p.title;
    $("modal-title").textContent = p.title;
    $("modal-note").textContent = p.note;
    $<HTMLDialogElement>("photo-modal").showModal();
  } else {
    $<HTMLImageElement>("comparison-img").src = `./photos/${p.file}`;
    $<HTMLImageElement>("comparison-img").alt = p.title;
    $("comparison-title").textContent = p.title;
    $("comparison-note").textContent = `${p.note} · 方向参考，非相机精确配准`;
    $("comparison").hidden = false;
  }
}

document.addEventListener("click", (event) => {
  const el = (event.target as Element).closest<HTMLElement>(
    "button, [data-room]",
  );
  if (!el) return;
  if (el.dataset.tab) switchTab(el.dataset.tab);
  if (el.dataset.camera) setCamera(el.dataset.camera as CameraName);
  if (el.dataset.existing) {
    isExisting = el.dataset.existing === "true";
    if (isExisting && camera === "garage") camera = "aerial";
    active("[data-existing]", (b) => b === el);
    updateScene();
    viewer?.setCamera(camera);
  }
  if (el.dataset.roofStyle) {
    roofStyle = parseRoofStyle(el.dataset.roofStyle);
    updateScene();
  }
  if (el.dataset.floor) {
    level = Number(el.dataset.floor);
    if (level < 0) {
      planMode = "2d";
      active("[data-plan-mode]", (b) => b.dataset.planMode === "2d");
      if (layoutEditing) layoutEditing = false;
    }
    layoutEditor?.clearSelectionOnFloorChange();
    updateScene();
    if (planMode === "3d" && level >= 0 && !checked("explode")) viewer?.setCamera("top");
  }
  if (el.dataset.planMode) {
    planMode = el.dataset.planMode;
    if (planMode === "3d" && layoutEditing) layoutEditing = false;
    if (planMode === "3d" && level < 0) level = 0;
    active("[data-plan-mode]", (b) => b === el);
    updateScene();
    if (planMode === "3d" && !checked("explode")) viewer?.setCamera("top");
  }
  if (el.id === "toggle-layout-edit") setLayoutEditing(!layoutEditing);
  if (el.dataset.editTool && layoutEditor) {
    const next = el.dataset.editTool as "select" | "wall" | "room" | "door" | "furniture";
    // 再点同一类别则收起面板，回到选择
    if (
      layoutEditor.tool === next &&
      (next === "room" || next === "door" || next === "furniture")
    ) {
      layoutEditor.setTool("select");
    } else {
      layoutEditor.setTool(next);
      if (next === "wall") toast("在平面图上点两点画隔墙；默认水平／竖直，Shift 斜墙");
    }
    syncLayoutPalette();
    refreshLayoutInspector();
  }
  if (el.dataset.paletteKind && layoutEditor) {
    if (paletteDragActive) return;
    const kind = el.dataset.paletteKind;
    if (layoutEditor.tool === "room") {
      layoutEditor.roomKind = kind as typeof layoutEditor.roomKind;
    } else if (layoutEditor.tool === "door") {
      layoutEditor.openingKind = kind as typeof layoutEditor.openingKind;
    } else if (layoutEditor.tool === "furniture") {
      layoutEditor.furnitureKind = kind as typeof layoutEditor.furnitureKind;
    }
    syncLayoutPalette();
    toast("已选中，请拖到平面图放置");
  }
  if (el.id === "plan-zoom-in") {
    setPlanZoom(planZoom + planZoomStep);
    return;
  }
  if (el.id === "plan-zoom-out") {
    setPlanZoom(planZoom - planZoomStep);
    return;
  }
  if (el.id === "plan-zoom-reset") {
    setPlanZoom(1);
    return;
  }
  if (el.id === "plan-focus-toggle") {
    setPlanEditorFocus(!planEditorFocus);
    return;
  }
  if (el.id === "toggle-wall-width") {
    showWallWidth = !showWallWidth;
    drawPlan();
    return;
  }
  if (el.id === "layout-save") {
    layoutEditor?.saveNow();
    void saveSchemeCurrent();
  }
  if (el.id === "layout-undo") layoutEditor?.undo();
  if (el.id === "layout-redo") layoutEditor?.redo();
  if (el.id === "layout-export") layoutEditor?.exportJson();
  if (el.id === "layout-reset") layoutEditor?.resetToPublished();
  if (el.dataset.editDelete !== undefined) layoutEditor?.deleteSelection();
  if (el.dataset.furnRotate !== undefined) layoutEditor?.rotateSelectedFurniture(Number(el.dataset.furnRotate));
  if (el.dataset.alignCenter === "opening") layoutEditor?.centerSelectedOpeningInBay();
  if (el.dataset.alignCenter === "furniture") layoutEditor?.centerSelectedFurnitureInRoom();
  if (el.dataset.alignCenter === "portico") layoutEditor?.centerSelectedPorticoInBay();
  if (el.dataset.photo) openPhoto(Number(el.dataset.photo));
  if (el.dataset.photoModal) openPhoto(Number(el.dataset.photoModal), true);
  if (el.dataset.season) {
    $<HTMLInputElement>("sun-date").value = `2026-${el.dataset.season}`;
    $("sun-report").innerHTML = "";
    updateSun();
  }
  if (el.dataset.room) {
    showRoom(el.dataset.room);
    document
      .querySelectorAll("[data-room]")
      .forEach((r) => r.classList.toggle("selected", r === el));
  }
  if (el.dataset.designIssue) {
    switchTab("design");
    review?.openIssue(el.dataset.designIssue);
  }
});
document.addEventListener("keydown", (e) => {
  const el = (e.target as Element).closest<HTMLElement>("[data-room]");
  if (el && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }
});
for (const id of ["roof", "dimensions", "context", "overlap", "main-building", "annex-building", "neighbor-side", "neighbor-rear", "neighbor-front", "neighbor-roadside"])
  $(id).addEventListener("change", updateScene);
for (const id of ["courtyard-finish-concrete", "courtyard-finish-tile", "neighbor-courtyard-finish-concrete", "neighbor-courtyard-finish-tile"])
  $(id).addEventListener("change", () => {
    updateScene();
  });
for (const id of ["balcony", "sun-balcony"])
  $(id).addEventListener("change", () => {
    balcony = $<HTMLSelectElement>(id).value === "local";
    $<HTMLSelectElement>("balcony").value = $<HTMLSelectElement>(
      "sun-balcony",
    ).value = balcony ? "local" : "none";
    updateScene();
  });
$("floor-select").addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement;
  if (!input.matches('input[name="floor"]') || !input.checked) return;
  level = Number(input.value);
  layoutEditor?.clearSelectionOnFloorChange();
  updateScene();
  if (planMode === "3d" && !checked("explode")) viewer?.setCamera("top");
});
$("explode").addEventListener("change", () => {
  if (checked("explode")) {
    planMode = "3d";
    active("[data-plan-mode]", (b) => b.dataset.planMode === "3d");
  }
  updateScene();
});
$("chair-clearance").addEventListener("change", drawPlan);
for (const id of ["room-inside", "room-clearance", "dining-mode"])
  $(id).addEventListener("change", drawPlan);
$("layout-import").addEventListener("change", async (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || !layoutEditor) return;
  try {
    layoutEditor.importJson(await file.text());
  } catch (error) {
    toast(error instanceof Error ? error.message : "导入失败");
  }
  input.value = "";
});
$("layout-palette-chips").addEventListener("dragstart", (event) => {
  const chip = (event.target as Element).closest<HTMLElement>("[data-palette-kind]");
  if (!chip || !(event instanceof DragEvent) || !event.dataTransfer) return;
  paletteDragActive = true;
  const payload = JSON.stringify({
    category: chip.dataset.paletteCategory,
    kind: chip.dataset.paletteKind,
  });
  event.dataTransfer.setData("application/x-anhua-layout", payload);
  event.dataTransfer.setData("text/plain", payload);
  event.dataTransfer.effectAllowed = "copy";
  chip.classList.add("dragging");
  $("plan-drawing").classList.add("layout-drop-target");
});
$("layout-palette-chips").addEventListener("dragend", (event) => {
  const chip = (event.target as Element).closest<HTMLElement>("[data-palette-kind]");
  chip?.classList.remove("dragging");
  $("plan-drawing").classList.remove("layout-drop-target");
  setTimeout(() => {
    paletteDragActive = false;
  }, 0);
});
$("plan-drawing").addEventListener("dragover", (event) => {
  if (!layoutEditing || !layoutEditor) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
});
$("plan-drawing").addEventListener("drop", (event) => {
  if (!layoutEditing || !layoutEditor || !(event instanceof DragEvent)) return;
  event.preventDefault();
  $("plan-drawing").classList.remove("layout-drop-target");
  const raw =
    event.dataTransfer?.getData("application/x-anhua-layout") ||
    event.dataTransfer?.getData("text/plain");
  if (!raw) return;
  let payload: { category?: string; kind?: string };
  try {
    payload = JSON.parse(raw) as { category?: string; kind?: string };
  } catch {
    return;
  }
  if (
    payload.category !== "room" &&
    payload.category !== "door" &&
    payload.category !== "furniture"
  ) {
    return;
  }
  if (!payload.kind) return;
  const svg = $("plan-drawing").querySelector("svg.floor-svg") as SVGSVGElement | null;
  if (!svg) return;
  layoutEditor.dropPlace(svg, event.clientX, event.clientY, payload.category, payload.kind);
  active("[data-edit-tool]", (b) => b.dataset.editTool === "select");
  syncLayoutPalette();
  toast("已放置，可在图上调整方位与大小");
});
$("plan-drawing").addEventListener(
  "wheel",
  (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    const delta = event.deltaY > 0 ? -planZoomStep : planZoomStep;
    setPlanZoom(planZoom + delta, { clientX: event.clientX, clientY: event.clientY });
  },
  { passive: false },
);
$("plan-drawing").addEventListener("scroll", () => positionLayoutInspector(), { passive: true });
window.addEventListener("resize", () => {
  syncLayoutChromeHeight();
  positionLayoutInspector();
});
$("layout-inspector").addEventListener("change", (event) => {
  const el = event.target as HTMLElement;
  if (!layoutEditor) return;
  if (el.id === "edit-room-name") {
    layoutEditor.updateSelectedName((el as HTMLInputElement).value);
    return;
  }
  const openingField = el.getAttribute("data-opening-field");
  if (openingField && el instanceof HTMLSelectElement) {
    layoutEditor.updateOpeningField(openingField, el.value);
    return;
  }
  const field = el.getAttribute("data-edit-field");
  if (field && el instanceof HTMLInputElement) {
    const value = parseLayoutNumber(el.value);
    if (value === null) {
      toast("请输入有效数字，可用小数点，例如 1.5");
      refreshLayoutInspector();
      return;
    }
    layoutEditor.updateSelectedNumber(field, value);
  }
});
$("layout-inspector").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const el = event.target;
  if (!(el instanceof HTMLInputElement) || !el.hasAttribute("data-edit-field")) return;
  event.preventDefault();
  el.blur(); // 触发 change，提交尺寸
});
function layoutEditorTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return !!el.isContentEditable;
}

document.addEventListener(
  "keydown",
  (event) => {
    if (layoutEditorTypingTarget(event.target)) return;
    if (event.key === "Escape" && planEditorFocus) {
      event.preventDefault();
      setPlanEditorFocus(false);
      return;
    }
    if (!layoutEditing || !layoutEditor) return;

    const arrow =
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight" ||
      event.key === "ArrowUp" ||
      event.key === "ArrowDown" ||
      event.code === "ArrowLeft" ||
      event.code === "ArrowRight" ||
      event.code === "ArrowUp" ||
      event.code === "ArrowDown";
    // 捕获阶段拦截方向键，避免工具栏按钮抢走后无法移动选中模型。
    if (arrow && layoutEditor.selections.length) {
      event.preventDefault();
      event.stopPropagation();
      const step = event.shiftKey ? 1 : 0.1;
      const key = event.key.startsWith("Arrow") ? event.key : event.code;
      if (key === "ArrowLeft") layoutEditor.nudgeSelection(-step, 0);
      else if (key === "ArrowRight") layoutEditor.nudgeSelection(step, 0);
      else if (key === "ArrowUp") layoutEditor.nudgeSelection(0, -step);
      else if (key === "ArrowDown") layoutEditor.nudgeSelection(0, step);
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      layoutEditor.saveNow();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) layoutEditor.redo();
      else layoutEditor.undo();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      layoutEditor.redo();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
      event.preventDefault();
      layoutEditor.copySelection();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") {
      event.preventDefault();
      layoutEditor.pasteClipboard();
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      layoutEditor.deleteSelection();
    }
    if (event.key === "Escape") {
      const paramsOpen = !document.getElementById("params-float")?.hidden;
      if (paramsOpen) {
        event.preventDefault();
        event.stopPropagation();
        setParamsPanelOpen(false);
        return;
      }
      event.preventDefault();
      layoutEditor.cancelWallDraft();
      if (layoutEditor.selections.length) {
        layoutEditor.selection = null;
        drawPlan();
      }
    }
    if (event.key.toLowerCase() === "r" && layoutEditor.selection?.kind === "furniture") {
      event.preventDefault();
      layoutEditor.rotateSelectedFurniture(event.shiftKey ? -90 : 90);
    }
  },
  true,
);
$("sun-date").addEventListener("change", () => {
  $("sun-report").innerHTML = "";
  updateSun();
});
$("sun-time").addEventListener("input", updateSun);
$("analyze-sun").addEventListener("click", async () => {
  const b = $<HTMLButtonElement>("analyze-sun");
  if (!viewer || !$<HTMLInputElement>("sun-date").value) return;
  b.disabled = true;
  b.textContent = "正在计算遮挡…";
  $("sun-report").setAttribute("aria-busy", "true");
  await new Promise((resolve) => setTimeout(resolve, 40));
  try {
    const rows = viewer.analyzeSun($<HTMLInputElement>("sun-date").value);
    $("sun-report").innerHTML =
      `<div class="sun-report-legend"><span><i></i>有直射点</span><span><i></i>全部受遮挡</span></div>${rows.map((r) => `<div class="sun-row"><strong>${r.name}</strong>${(["plain", "balcony"] as const).map((key) => `<div class="sun-sample-row"><span>${key === "plain" ? "无阳台" : "浅阳台"}</span><div class="sun-samples">${r.samples.map((s) => `<i style="--lit:${s[key] / 3}" title="${timeText(s.hour)} · ${s[key]}/3点有直射光"></i>`).join("")}</div></div>`).join("")}</div>`).join("")}<div class="sample-axis"><span>07:00</span><span>12:00</span><span>17:00</span></div><p class="micro">颜色为当前模型采样结果，不包含天气、室内反射光和未测绘远山的精确遮挡。</p>`;
  } catch {
    $("sun-report").textContent = "本次计算未完成，请重试。";
  } finally {
    b.disabled = false;
    b.textContent = "重新计算南窗遮挡";
    $("sun-report").removeAttribute("aria-busy");
  }
});
$("open-garage").addEventListener("click", () => setCamera("garage"));
$("leave-garage").addEventListener("click", () => setCamera("aerial"));
for (const id of ["road-level", "ramp-length"])
  $(id).addEventListener("input", updateRamp);
for (const id of ["fen-shui", "fen-shui-number"])
  $(id).addEventListener("input", (event) => updateFenShui(event.target as HTMLInputElement));
$("route-progress").addEventListener("input", updateRoute);
for (const [id, layer] of [["route-sweep", "sweep"], ["route-clearance", "clearance"], ["route-conflicts", "conflicts"]] as const)
  $(id).addEventListener("change", () => viewer?.setRouteLayers({ [layer]: checked(id) }));
$("route-findings").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-route-to]");
  if (!button) return;
  $<HTMLInputElement>("route-progress").value = button.dataset.routeTo!;
  updateRoute();
});
$("reset-camera").addEventListener("click", () =>
  viewer?.setCamera(tab === "floor" ? "top" : camera),
);
$("save-view").addEventListener("click", () => {
  if (viewer) {
    const data = viewer.exportImage();
    $<HTMLImageElement>("export-image").src = data;
    $<HTMLAnchorElement>("export-download").href = data;
    $<HTMLAnchorElement>("export-download").download =
      `安化山居-${viewer.activeCamera}.png`;
    $<HTMLDialogElement>("export-modal").showModal();
  }
});
$("record-view").addEventListener("click", () => review?.saveSnapshot());
$("fullscreen").addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    toast("当前浏览器不支持全屏，请使用浏览器缩放。");
  }
});
$("close-comparison").addEventListener("click", () => {
  $("comparison").hidden = true;
});
$("photo-expand").addEventListener("click", () => openPhoto(photoIndex, true));
$("match-photo").addEventListener("click", () => {
  $<HTMLDialogElement>("photo-modal").close();
  switchTab("model");
  setCamera(photos[photoIndex].camera as CameraName);
  openPhoto(photoIndex);
});
$("pending-only").addEventListener("change", renderFacts);
$("footer-sources").addEventListener("click", (e) => {
  e.preventDefault();
  switchTab("sources");
});
$("download-data").addEventListener("click", () => {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          projectMeta,
          meeting: review?.exportSession(),
          description: "概念模型参数，不能作为测绘或施工图使用。",
          units: "m",
          axes: "X东 Y上 Z南；旧前坪外缘Z=0",
          site,
          buildingAreas,
          surroundings,
          facts,
          floors,
          garageRoute: {
            status: "模型平面筛查，通行未确认",
            evidence: "原空间探索曲线与模型柱墙投影，实际结构和标高待测",
            vehicle: site.vehicle,
            controlPoints: viewer?.route.points.map((p) => [p.x, p.z]),
            retainedDeck: garageLayout.retainedDeck,
            proposedCut: garageLayout.proposedCut,
            modelObstacles: garageLayout.obstacles,
            limitations: "含镜宽、可靠转弯参数、纵坡俯仰、底盘、驶出及第二辆车独立进出均待校核",
          },
          preview: {
            roofStyle,
            courtyardFinish: selectedCourtyardFinish("courtyard-finish"),
            neighborCourtyardFinish: selectedCourtyardFinish("neighbor-courtyard-finish"),
            fenShui: Number($<HTMLInputElement>("fen-shui").value),
            villaParams: getVillaParams(),
            roadY: viewer?.roadY,
            rampLength: viewer?.rampLength,
            roadAndRampEvidence: "设计示意，未测",
            balcony,
          },
        },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = "安化山居-方案参数.json";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
});
review = mountDesignReview($("design-panel"), {
  getView: captureMeetingView, restore: restoreMeetingView,
  options: () => ({ fenShui: Number($<HTMLInputElement>("fen-shui").value), roadY: viewer?.roadY ?? surroundings.road.entryY, rampLength: viewer?.rampLength ?? 5 }),
  navigate: locateDesignIssue, image: () => viewer?.exportImage(), toast,
});
{
  fillVillaParamsDom(DEFAULT_VILLA_PARAMS);
  syncFenShuiInputs(DEFAULT_VILLA_PARAMS.roofFenShui);
  refreshAreaMetrics();
  syncVillaParamsWidthSum();
}
bindParamsInnerTabs();
document.getElementById("open-params-panel")?.addEventListener("click", () => {
  const panel = document.getElementById("params-float");
  setParamsPanelOpen(!!panel?.hidden);
});
document.getElementById("open-params-from-inspector")?.addEventListener("click", () => {
  setParamsPanelOpen(true);
});
document.getElementById("params-float")?.addEventListener("click", (event) => {
  const t = event.target as HTMLElement | null;
  if (t?.closest?.("[data-params-close]")) setParamsPanelOpen(false);
});
document.addEventListener("pointerdown", (event) => {
  const panel = document.getElementById("params-float");
  if (!panel || panel.hidden) return;
  const t = event.target as Element | null;
  if (!t) return;
  if (panel.contains(t)) return;
  if (t.closest("#open-params-panel, #open-params-from-inspector")) return;
  setParamsPanelOpen(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !document.getElementById("params-float")?.hidden) {
    setParamsPanelOpen(false);
  }
});
window.addEventListener("resize", () => {
  if (!document.getElementById("params-float")?.hidden) positionParamsFloat();
});
$("villa-params-apply").addEventListener("click", () => {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement && active.dataset.villaParam) {
    active.blur();
    sanitizeVillaParamInput(active, true);
  }
  void commitVillaParams(readVillaParamsFromDom(document, { finalize: true }));
});
document.getElementById("scheme-save-current")?.addEventListener("click", () => {
  void saveSchemeCurrent();
});
document.getElementById("scheme-save-version")?.addEventListener("click", () => {
  void saveSchemeVersion();
});
document.getElementById("scheme-load-version")?.addEventListener("click", () => {
  void (async () => {
    const select = document.getElementById("scheme-version-select") as HTMLSelectElement | null;
    const file = select?.value;
    if (!file) {
      toast("请先选择一个已保存版本");
      return;
    }
    const doc = await loadSchemeVersion(file);
    if (!doc) {
      toast("载入版本失败");
      return;
    }
    await applySchemeDocument(doc, { toastMsg: "正在载入版本…" });
    toast(`已载入版本：${doc.title}`);
  })();
});
$("villa-params-reset").addEventListener("click", () => {
  void resetSchemeToInitial();
});
document.getElementById("villa-params-scroll")?.addEventListener("input", (event) => {
  const input = (event.target as HTMLElement | null)?.closest?.("input[data-villa-param]") as HTMLInputElement | null;
  if (input) sanitizeVillaParamInput(input, false);
  syncVillaParamsWidthSum();
  const fen = document.querySelector<HTMLInputElement>('[data-villa-param="roofFenShui"]');
  if (fen && document.activeElement === fen) {
    const fenValue = Number(fen.value);
    if (Number.isFinite(fenValue)) syncFenShuiInputs(fenValue);
  }
});
document.getElementById("villa-params-scroll")?.addEventListener("blur", (event) => {
  const input = (event.target as HTMLElement | null)?.closest?.("input[data-villa-param]") as HTMLInputElement | null;
  if (!input) return;
  sanitizeVillaParamInput(input, true);
  syncVillaParamsWidthSum();
}, true);
renderFacts();
drawPlan();
updateFenShui();
const clear = diningClearance();
$("dining-warning").textContent =
  `按当前拉椅包络，西侧余量${clear.west.toFixed(2)} m、北侧${clear.north.toFixed(2)} m；东侧仅${clear.east.toFixed(2)} m。两桌拉椅包络局部相交，满座上菜需错让。`;
await new Promise((resolve) => requestAnimationFrame(resolve));
try {
  viewer = new VillaViewer($("viewport"));
  viewer.onCompass = (angle) =>
    $("compass-arrow").setAttribute(
      "transform",
      `rotate(${(angle * 180) / Math.PI} 26 26)`,
    );
  viewer.onContextLoss = () => {
    $("loading").hidden = false;
    $("loading").innerHTML =
      "<strong>图形上下文已中断</strong><p>请刷新页面恢复3D；仍可查看分层平面与资料。</p>";
  };
  updateSun();
  updateRamp();
  updateScene();
  const initialView = new URLSearchParams(location.search).get("view");
  if (initialView === "roadside" || initialView === "garage") setCamera(initialView);
  $("loading").hidden = true;
} catch (error) {
  console.error(error);
  $("loading").innerHTML =
    "<strong>当前环境未能启动3D</strong><p>请在支持WebGL2的浏览器打开。分层平面与资料仍可查看。</p>";
  toast("3D加载失败，平面图与资料可以继续查看。");
}
const initialTab = new URLSearchParams(location.search).get("tab");
if (initialTab && ["model", "floor", "sun", "sources", "real", "design", "originals"].includes(initialTab)) switchTab(initialTab);

// 从 scheme 文件载入方案；若无文件则尝试迁移旧 localStorage 一次后清空缓存键。
{
  let boot = await loadCurrentScheme();
  if (!boot) {
    const legacy = migrateLegacyLocalStorage();
    if (legacy) {
      boot = { ...resetSchemeDocument(), ...legacy, schema: "anhua-villa-scheme-v1", id: "current", title: "从浏览器缓存迁移", savedAt: new Date().toISOString() };
      const migrated = await persistSchemeFile("current", boot as SchemeDocument);
      setSchemeStatus(migrated.message);
      toast("已将浏览器旧缓存迁到方案文件，请确认后点「保存到文件」");
    }
  }
  clearLegacyLocalStorage();
  if (boot) {
    await applySchemeDocument(boot, { toastMsg: "正在载入方案文件…" });
  } else {
    applyVillaParams(DEFAULT_VILLA_PARAMS);
    fillVillaParamsDom(DEFAULT_VILLA_PARAMS, document, { force: true });
    setSchemeStatus("使用初始化默认值；改完请「保存到文件」写入 public/scheme/current.json");
  }
  await refreshSchemeVersionSelect();
}
