import { loadingOverlayHtml } from "./loading-overlay";
import { createFurniture, type FurnitureKind } from "./furniture-catalog";
import { floorplanCategories, getFloorplanFurniture } from "./floorplan-catalog";
import { furnitureSymbol, planRoomColors, type PlanSource } from "./plan";
import { roomAreas } from "./design-data";
import { escapeHtml } from "./project-meta";
import { formatMm } from "./units";

export type LibraryCategory = "wall" | "room" | "door" | "furniture";
export type LibraryItem = { value: string; text: string; active: boolean };

const iconPaths: Record<string, string> = {
  select: '<path d="m5 3 12 9-6 1-3 6Z"/>',
  wall: '<rect x="4" y="3" width="12" height="14" rx="1"/><path d="M8 3v14m4-14v14"/>',
  room: '<rect x="3" y="3" width="14" height="14" rx="1"/><path d="M7 3v5h10M7 12v5"/>',
  door: '<path d="M4 17V3h12v14M8 17V5l8-2M11 10h1"/>',
  furniture:
    '<rect x="3" y="8" width="14" height="8" rx="2"/><path d="M5 8V4h10v4M3 12h14M5 16v2m10-2v2"/>',
  undo: '<path d="m7 3-4 4 4 4M3 7h8a6 6 0 0 1 0 12"/>',
  redo: '<path d="m13 3 4 4-4 4m4-4H9a6 6 0 0 0 0 12"/>',
  save: '<path d="M4 3h10l3 3v11H3V3Z"/><path d="M6 3v5h7V3M6 17v-6h8v6"/>',
  search: '<circle cx="8" cy="8" r="5"/><path d="m12 12 5 5"/>',
  expand: '<path d="M7 3H3v4m10-4h4v4M3 13v4h4m10-4v4h-4"/>',
  chevron: '<path d="m6 8 4 4 4-4"/>',
  pan: '<path d="M7 11V5a1.5 1.5 0 0 1 3 0v5-6a1.5 1.5 0 0 1 3 0v6-4a1.5 1.5 0 0 1 3 0v5-2a1.5 1.5 0 0 1 3 0v5c0 4-2 6-6 6-2 0-3-1-4-2l-4-5a1.5 1.5 0 0 1 2-2l2 2"/>',
  measure: '<path d="m3 13 10-10 5 5L8 18Zm3-3 2 2m1-5 2 2m1-5 2 2"/>',
  target: '<circle cx="10" cy="10" r="5"/><path d="M10 2v4m0 8v4M2 10h4m8 0h4"/>',
};

export function designerIcon(name: string) {
  return `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] ?? iconPaths.room}</svg>`;
}

export function planDesignerHtml(floorNames: string[]) {
  const tool = (value: string, label: string) =>
    `<button type="button" data-edit-tool="${value}" ${value === "select" ? 'class="active"' : `id="tool-${value}" aria-expanded="false"`}>${designerIcon(value)}${label}</button>`;
  return `<div id="plan-panel" class="plan-panel designer-grid" hidden>
    <div class="plan-toolbar">
      <h1>户型设计</h1>
      <div class="designer-view-switch" role="group" aria-label="户型显示方式"><button type="button" data-plan-mode="2d" class="active" aria-pressed="true">2D 平面</button><button type="button" data-plan-mode="3d" aria-pressed="false">3D 场景</button></div>
      <div class="floor-pills"><button data-floor="-1" type="button">院坪</button>${floorNames.map((name, i) => `<button data-floor="${i}" type="button" class="${i === 0 ? "active" : ""}">${escapeHtml(name)}</button>`).join("")}<button data-roof-plan type="button">屋顶</button><button data-elevation-plan type="button">立面图</button></div>
      <div class="plan-toolbar-actions">
        <label class="layout-version-label"><span>选择户型</span><select id="layout-version-select" aria-label="选择已保存的户型版本（一二三楼一体）"><option value="">（当前草稿）</option></select></label>
        <details class="designer-file-menu"><summary>文件 ${designerIcon("chevron")}</summary><div class="designer-menu-pop">
          <button type="button" id="layout-new-version">新增户型</button><button type="button" id="layout-copy-version" title="复制当前三层户型，包含未保存的编辑">复制户型</button><button type="button" id="layout-rename-version">重命名</button><button type="button" id="layout-delete-version" class="designer-danger">删除版本</button>
          <hr/><button type="button" id="layout-export">导出定稿 JSON</button><label class="layout-file-button">导入 JSON<input type="file" id="layout-import" accept="application/json,.json"/></label><button type="button" id="layout-reset">恢复正式数据</button>
        </div></details>
        <button type="button" id="toggle-layout-edit" aria-pressed="false">编辑布局</button>
      </div>
    </div>
    <div id="layout-edit-bar" class="layout-edit-bar" hidden>
      <div class="layout-tools" role="toolbar" aria-label="布局编辑类别">${tool("select", "选择")}${tool("wall", "隔墙")}${tool("room", "房间")}${tool("door", "门窗")}${tool("furniture", "家具")}</div>
        <div class="designer-history"><button type="button" id="layout-magnet-snap" class="active" aria-pressed="true" title="墙体拖近同向墙线时对齐；墙端接外墙外皮或内墙中心线；Shift拖动暂时关闭">吸附对齐</button><button type="button" id="layout-undo">${designerIcon("undo")}撤销</button><button type="button" id="layout-redo">${designerIcon("redo")}重做</button><button type="button" id="layout-save" class="layout-save-btn">${designerIcon("save")}保存</button></div>
      <div class="designer-layers" role="group" aria-label="图纸显示图层">${[
        ["dims", "尺寸"],
        ["labels", "房间名"],
        ["furniture", "家具"],
        ["grid", "网格"],
      ]
        .map(
          ([value, text]) =>
            `<button type="button" data-designer-layer="${value}" aria-pressed="true">${text}</button>`,
        )
        .join(
          "",
        )}<button type="button" id="toggle-wall-width" aria-pressed="false" title="显示墙厚毫米标注">墙厚</button></div>
    </div>
    ${loadingOverlayHtml({ id: "plan-loading", text: "正在载入户型…", className: "plan-loading" })}
    <div class="plan-canvas-wrap">
      <aside id="layout-palette" class="layout-palette" aria-label="模型素材库">
        <div class="layout-palette-head"><strong id="layout-palette-label">家具库</strong><span id="designer-library-count"></span></div>
        <label class="designer-search">${designerIcon("search")}<input id="designer-library-search" type="search" placeholder="搜索模型" aria-label="搜索模型" autocomplete="off"/></label>
        <div class="designer-library-filters" id="designer-library-filters" role="group" aria-label="家具分类">${["全部", ...floorplanCategories].map((name, i) => `<button type="button" data-library-group="${name}" class="${i === 0 ? "active" : ""}" aria-pressed="${i === 0}">${name}</button>`).join("")}</div>
        <p id="layout-palette-hint" class="layout-palette-hint">选择模型后，拖到图纸放置</p>
        <div class="layout-palette-chips" id="layout-palette-chips" role="listbox" aria-label="可用模型"></div>
        <p id="designer-library-empty" class="designer-empty" hidden>没有匹配的模型</p>
      </aside>
      <div class="designer-canvas">
        <div class="plan-scroll" id="plan-drawing"></div>
        <div id="editor-plan-tools" class="editor-canvas-tools">
          <div class="editor-tool-group" role="toolbar" aria-label="画布操作">
            <button type="button" data-canvas-tool="select" aria-pressed="true" class="active" title="选择对象（V）">${designerIcon("select")}选择</button>
            <button type="button" data-canvas-tool="pan" aria-pressed="false" title="平移画布（H），也可按住空格或鼠标中键拖动">${designerIcon("pan")}平移</button>
            <button type="button" data-canvas-tool="measure" aria-pressed="false" title="临时测距（M）">${designerIcon("measure")}测距</button>
            <details class="editor-room-menu"><summary>自动成房 ${designerIcon("chevron")}</summary><div><button type="button" data-auto-rooms="main">生成／更新主楼房间</button><button type="button" data-auto-rooms="annex" id="editor-auto-annex">生成／更新辅楼房间</button></div></details>
          </div>
        </div>
        <p id="editor-mode-hint" class="editor-mode-hint" hidden></p>
        <div id="editor-plan-scale" class="editor-plan-scale"><span class="editor-north">南 ↑</span><span id="editor-scale-value">1000 mm</span><i id="editor-scale-line"></i></div>
        <div id="designer-scene" class="designer-scene" hidden>
          <div id="designer-scene-host" class="designer-scene-host"></div>
          <div class="designer-scene-tools" role="group" aria-label="三维视图设置">
            <div><button type="button" data-designer-camera="orbit" class="active" aria-pressed="true">环绕视角</button><button type="button" data-designer-camera="top" aria-pressed="false">俯视</button><button type="button" id="designer-walk" aria-pressed="false">漫游</button><button type="button" id="designer-night" aria-pressed="false">夜景</button></div>
            <div><button type="button" data-editor-wall-height="1200" class="active" aria-pressed="true">剖切墙</button><button type="button" data-editor-wall-height="full" aria-pressed="false">全高墙</button><span class="editor-tool-separator"></span><button type="button" id="designer-explode" aria-pressed="false">楼层分离</button><button type="button" id="designer-scene-export">保存图片</button></div>
          </div>
          <p class="designer-scene-hint">拖动空白处旋转 · 右键平移 · 滚轮缩放 · 点选家具后可拖动摆放</p>
          <p id="designer-walk-hint" class="designer-walk-hint" hidden>WASD / 方向键 移动 · 拖动鼠标转向 · Shift 快走 · Esc 退出</p>
          <div id="designer-walk-intro" class="designer-walk-intro" hidden>
            <section class="designer-walk-card" role="dialog" aria-labelledby="designer-walk-title" aria-describedby="designer-walk-description">
              <h2 id="designer-walk-title">漫游模式</h2>
              <p id="designer-walk-description">从当前楼层进入，选中房间时从该房间出发</p>
              <p><kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> 或方向键移动 · 拖动鼠标转向</p>
              <p><kbd>Shift</kbd> 快走 · <kbd>Esc</kbd> 退出</p>
              <div class="designer-walk-actions"><button type="button" id="designer-walk-cancel">取消</button><button type="button" id="designer-walk-start">开始漫游</button></div>
            </section>
          </div>
          <button type="button" id="designer-walk-exit" class="designer-walk-exit" hidden>退出漫游</button>
        </div>
        <div id="editor-selection-bar" class="editor-selection-bar" role="toolbar" aria-label="选中对象快捷操作" hidden>
          <strong id="editor-selection-title"></strong><span class="editor-tool-separator"></span>
          <button type="button" data-editor-action="focus" title="定位选中对象">${designerIcon("target")}定位</button>
          <button type="button" data-editor-action="rotate-left">左转90°</button><button type="button" data-editor-action="rotate-right">右转90°</button>
          <button type="button" data-editor-action="duplicate">复制</button><button type="button" data-editor-action="delete" class="editor-action-danger">删除</button><button type="button" data-editor-action="done" class="editor-action-done">完成</button>
        </div>
        <div class="plan-zoom-controls" role="group" aria-label="平面图缩放"><button type="button" id="plan-zoom-out" aria-label="缩小">−</button><button type="button" id="plan-zoom-reset" title="适应窗口" aria-label="适应窗口">100%</button><button type="button" id="plan-zoom-in" aria-label="放大">+</button><button type="button" id="plan-focus-toggle" title="撑满编辑区域" aria-label="撑满编辑区域" aria-pressed="false">${designerIcon("expand")}</button></div>
      </div>
      <aside id="designer-properties" class="designer-properties" aria-label="属性与房间面积">
        <section class="designer-property-section"><div class="designer-section-heading"><h2>属性</h2><button type="button" id="designer-inspector-float" aria-pressed="false" title="将属性切换为可拖动浮窗">浮动</button></div><div id="designer-inspector-empty" class="designer-empty-selection">${designerIcon("select")}<span>选择画布中的对象以编辑属性</span></div><div id="layout-inspector" class="layout-inspector" hidden></div></section>
        <section class="designer-column-legend"><h2>柱位图例</h2><p><i class="column-swatch"></i>门厅／官帽柱 <i class="column-swatch short"></i>栏杆短柱</p><p class="designer-note">包角色块为饰件。柱位沿用模型示意，待结构设计确认；室内结构柱尚未布置。</p></section>
        <section><div class="designer-section-heading"><h2>房间面积</h2><span>净空 · ㎡</span></div><div id="designer-room-list"></div><p class="designer-note">按当前房间轮廓与模型墙厚计算，未扣柱梁、装修与设备；非建筑面积认定。</p></section>
        <section><h2>方案统计</h2><div id="designer-plan-stats" class="designer-plan-stats"></div><p id="designer-building-area" class="designer-note"></p></section>
        <section class="designer-display-options"><h2>显示设置</h2><button type="button" data-designer-display="chair-clearance" aria-pressed="true" title="圆桌桌缘外550 mm的拉椅讨论留位；随桌子位置和直径变化">餐厅拉椅范围</button><button type="button" data-designer-display="room-clearance" aria-pressed="false">家具使用讨论留位</button><label>辅楼前圆桌情景<select id="designer-dining-mode" aria-label="平面图辅楼圆桌情景"><option value="full">室外圆桌 · 6座</option><option value="daily">圆桌收起 · 日常</option></select></label><button type="button" data-design-issue="D08">记录房间深化意见 ↗</button></section>
      </aside>
    </div>
    <div class="designer-status"><span id="plan-orient-hint">南 ↑ · 西 →</span><span>单位 mm</span><span>三层户型联动</span><span id="layout-save-status" class="layout-save-status" aria-live="polite"></span><span id="designer-status-hint" class="designer-status-hint">选择模型后拖入图纸 · Ctrl/⌘ + 滚轮缩放</span><span>概念方案 · 待实测与设计</span></div>
  </div>`;
}

export function libraryCardsHtml(
  category: LibraryCategory,
  items: LibraryItem[],
) {
  return items
    .map((item) => {
      const f =
        category === "furniture"
          ? createFurniture(item.value as FurnitureKind, 0, 0)
          : null;
      const model = f ? getFloorplanFurniture(f.kind) : undefined;
      const group = model?.category ?? "全部";
      const pad = f ? Math.max(f.w, f.d) * 0.15 : 0;
      const preview = f
        ? `<svg class="designer-furniture-preview" viewBox="${-f.w / 2 - pad} ${-f.d / 2 - pad} ${f.w + 2 * pad} ${f.d + 2 * pad}" aria-hidden="true"><g transform="rotate(180)">${furnitureSymbol(f)}</g></svg>`
        : category === "room" && item.value.startsWith("stair")
          ? `<svg viewBox="0 0 64 48" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">${item.value === "stair-triple"
            ? '<path d="M5 43V5h54v38H45V19H19v24Z M5 28h14M5 34h14M5 39h14M45 28h14M45 34h14M45 39h14M24 5v14M30 5v14M36 5v14M42 5v14"/>'
            : '<path d="M13 43V5h38v38H37V19H27v24Z M13 25h14M13 31h14M13 37h14M37 25h14M37 31h14M37 37h14"/>'}</svg>`
          : category === "door" && item.value === "passage"
            ? '<svg viewBox="0 0 64 48" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M4 44V4h56v40H46V16H18v28Z"/></svg>'
            : designerIcon(category);
      const dimensions = f
        ? `${formatMm(f.w)}×${formatMm(f.d)}`
        : item.value === "stair-triple" ? "U形 · 三跑"
        : item.value === "stair" ? "双跑折返"
        : category === "wall"
          ? item.value === "virtual"
            ? "无厚度 · 虚线分界"
            : "两点绘制或拖入"
          : category === "door"
            ? item.value === "passage" ? "留空通行 · 无门扇" : "拖到墙上放置"
            : "拖入后调整尺寸";
      return `<button type="button" role="option" class="layout-chip${item.active ? " active" : ""}" draggable="true" data-palette-category="${category}" data-palette-kind="${item.value}" data-library-group-name="${group}" data-library-search="${escapeHtml(item.text)}" aria-selected="${item.active}" title="${escapeHtml(item.text)}：选择后点击画布或拖入放置">${preview}<strong>${escapeHtml(item.text)}</strong><small>${dimensions}</small></button>`;
    })
    .join("");
}

export function designerRoomListHtml(
  source: PlanSource,
  level: number,
  selectedId?: string,
  selectedAnnex = false,
) {
  const rows = (annex: boolean) => {
    const rooms = annex ? source.annexRooms : source.floor.rooms;
    const partitions = annex ? source.annexPartitions : source.floor.partitions;
    return rooms
      .filter((room) => room.kind !== "void")
      .map(
        (room) =>
          `<button type="button" class="designer-room-row${room.id === selectedId && annex === selectedAnnex ? " active" : ""}" data-designer-room="${escapeHtml(room.id)}" data-designer-annex="${annex}" title="选择${escapeHtml(room.name)}并编辑属性"><i style="background:${planRoomColors[room.kind]}"></i><span>${escapeHtml(room.name)}</span><b>${roomAreas(room, level, partitions).interior.toFixed(2)}</b></button>`,
      )
      .join("");
  };
  return `<div class="designer-room-group">主楼 · ${escapeHtml(source.floor.name)}</div>${rows(false) || '<p class="designer-note">暂无房间，绘制墙体后可自动生成。</p>'}${level === 0 ? `<div class="designer-room-group">辅楼 · 一层</div>${rows(true)}` : ""}`;
}
