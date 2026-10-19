import { annexRooms, buildingAreas, construction, facts, floors, frontElevation, site } from "./data";
import { facades } from "./facades";
import { bedroomSummary, designBrief, designIssues, entranceMetrics, floorFinish, roomReference } from "./design-data";
import { designDrawings, drawingStyles, elevation, unresolvedConditions, type DrawingOptions } from "./design-drawings";
import type { DesignSession, MeetingView } from "./design-session";
import { courtyardSitePlan, floorPlan } from "./plan";
import { escapeHtml as e, projectMeta, meetingTabLabels, cameraViewLabels } from "./project-meta";
import { courtyardFinishLabels } from "./courtyard-finishes";
import { roofStyleLabels } from "./roof-options";
import { derivedWestGap, getVillaParams } from "./villa-params";
import { formatMm } from "./units";

export function controlTable() {
  const m = entranceMetrics();
  const vp = getVillaParams();
  return `<table><caption>当前控制尺寸 · 单位 mm（面积 ㎡）</caption><thead><tr><th>对象与起止口径</th><th>模型数值</th><th>状态</th></tr></thead><tbody>${[
    ["总宽：西侧＋辅楼＋子孙道＋主楼＋东侧", `${[derivedWestGap(vp), vp.annexWidth, vp.lane, vp.mainWidth, vp.eastGap].map(formatMm).join("＋")}＝${formatMm(derivedWestGap(vp) + vp.annexWidth + vp.lane + vp.mainWidth + vp.eastGap)}`, "方案控制；界址待测"],
    ["主楼／辅楼主体首层投影", `${buildingAreas.main}／${buildingAreas.annex}㎡`, "主体按当前参数合计；报建口径待确认"],
    ["门厅楼板投影", `${formatMm(site.portico.w)}×${formatMm(m.projection)}＝${buildingAreas.portico.toFixed(1)}㎡`, "几何投影另计；不代表全部外伸占地"],
    ["自前墙北外皮→柱北外皮／平台／最外踏步", `${formatMm(m.column)}／${formatMm(m.platform)}／${formatMm(m.steps)}`, "不同控制线，勿当成同一门厅投影"],
    ["主辅楼首层完成面／两楼间连接地坪", `${elevation(floorFinish(0))}／${elevation(m.connectionY)}`, `相差${formatMm(m.connectionRise)}；通行做法待设计`],
    ["入口侧坡道：名义高差／投影长度", `${formatMm(site.entranceRise)}／${formatMm(m.rampRun)} ≈ ${m.rampGrade.toFixed(1)}%`, "几何尺度示意；适老通行待核"],
    ["墙身层高／各层完成面", `${floors.map((f) => formatMm(f.height)).join("／")}；${floors.map((_, i) => elevation(floorFinish(i))).join("／")}`, "首层抬高；楼梯高差非统一层高"],
    ["地库地面／结构预留／净高目标", `${formatMm(site.garageFloor)}／${formatMm(site.deckStructure)}／${formatMm(site.garageClear)}`, "均为示意或目标，结构及最低净高待核"],
    ["短柱柱身＋挡墙（盖板另计）", `${formatMm(frontElevation.balustradePostHeight)}＋${formatMm(frontElevation.eaveParapet)}＝${formatMm(frontElevation.balustradePostHeight + frontElevation.eaveParapet)}`, "造型尺寸；栏杆安全及连接待设计"],
  ].map((row) => `<tr>${row.map((v, i) => `<${i ? "td" : "th"}>${e(v)}</${i ? "td" : "th"}>`).join("")}</tr>`).join("")}</tbody></table>`;
}
export function roomSchedule() {
  return `<table><caption>逐层房间 · 包含套卫，不汇总为可用面积</caption><thead><tr><th>层／房间</th><th>外轮廓 mm</th><th>模型墙内侧参考 mm</th><th>注意事项</th></tr></thead><tbody>${floors.map((f, i) => [...f.rooms, ...(i === 0 ? annexRooms : [])].filter((r) => r.kind !== "void").map((r) => {
    const ref = roomReference(r, i);
    return `<tr><th>${e(f.name)} · ${e(r.name)}</th><td>${formatMm(r.w)}×${formatMm(r.d)}</td><td>${formatMm(ref.w)}×${formatMm(ref.d)}</td><td>${e(ref.nested.length ? `含${ref.nested.map((n) => n.name).join("、")}；非可用净矩形` : r.purposeStatus ? "用途待确认" : "待扣装修、柱及设备；非实测")}</td></tr>`;
  }).join("")).join("")}</tbody></table><p>内侧参考按模型外墙${formatMm(construction.outsideWall)}、贴边隔墙半厚${formatMm(construction.partition / 2)}（mm）估计，局部隔墙按整边参考。开敞边不算实体墙；未扣套卫占用、结构与装修，不用于订家具或结算面积。</p>`;
}
export function openingSchedule() {
  return `<table><caption>模型墙体洞口（非门窗加工表）</caption><thead><tr><th>编号／位置</th><th>类型</th><th>宽×高 mm</th><th>洞底／洞顶相对院坪 mm</th></tr></thead><tbody>${[0, 1, 2, 3].map((index) => facades(index).flatMap((wall, face) => wall.openings.map((o, n) => {
    const base = index === 3 ? 0 : floors[index].y;
    const body = index === 3 ? site.annex : site.main;
    const midX = body.x + body.w / 2, midZ = body.z + body.d / 2;
    const side = Math.abs(wall.a[1] - wall.b[1]) < 10 ? (wall.a[1] < midZ ? "北" : "南") : (wall.a[0] < midX ? "西" : "东");
    return `<tr><th>${index === 3 ? "辅楼" : floors[index].name} ${side}${face + 1}-${n + 1}</th><td>${o.open ? "开敞" : o.door ? "门洞" : "窗洞"}${o.span ? "·跨层分段" : ""}</td><td>${formatMm(o.w)}×${formatMm(o.h)}</td><td>${elevation(base + o.sill)}／${elevation(base + o.sill + o.h)}</td></tr>`;
  }))).flat().join("")}</tbody></table><p>洞底沿墙模原始基准，不自动随首层完成面抬高；门槛、净开口及框套有待设计复核。跨层洞口分段记录，不合计成两樘窗。</p>`;
}
const tableStyles = `table{border-collapse:collapse;width:100%;font-size:13px;margin:14px 0}caption{text-align:left;font-weight:700;margin:8px 0}th,td{border-bottom:1px solid #dce3d9;padding:9px 8px;text-align:left;vertical-align:top}th{font-weight:600}thead{background:#eff3eb}p{line-height:1.7}small{color:#637268}.tag{color:#966025;font-size:12px}article{border:1px solid #dce3d9;padding:16px;margin:14px 0;border-radius:8px}h3{margin:0 0 8px}.note{white-space:pre-wrap;background:#f5f5ed;padding:12px}.warning{padding:14px;background:#fcf0d8;border-left:3px solid #b77a36}`;

export function meetingBooklet(session: DesignSession, options: DrawingOptions, view: MeetingView, image?: string) {
  const timestamp = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
  let page = 0;
  const section = (title: string, body: string) => `<section class="book-page"><header><span>安化山居 · 设计沟通资料</span><span>${e(projectMeta.revision)} · ${e(projectMeta.date)}</span></header><h1>${e(title)}</h1>${body}<footer>第 ${++page} 页组 · 院坪暂定±0.000 · 非测绘／施工图／通行认定</footer></section>`;
  const drawings = designDrawings(options);
  const pages = [
    section("设计任务书与会议补充", `<p class="warning">${e(projectMeta.status)}。道路与最低梁底待联测，切口协商待确认；车行、人行、结构、排水均未据模型认定通过。</p><p>导出时间：${e(timestamp)}（北京时间）。当前模型${e(projectMeta.revision)}；实景复制模型基准${projectMeta.realSceneBase}，生成合成图不自动同步。</p>${designBrief.map((b) => `<article><small class="tag">${e(b.status)}</small><h3>${e(b.title)}</h3><p>${e(b.text)}</p></article>`).join("")}<h2>业主会前补充</h2><p class="note">${e(session.brief || "待补：常住与节庆人数、老人需求、卧室口径、预算范围、地库和外观优先级。")}</p>`),
    section("控制尺寸与标高", controlTable() + `<p>屋面分水${options.fenShui.toFixed(1)}；道路接入${Math.round(options.roadY)} mm、坡长${Math.round(options.rampLength)} mm均是当前探索值（单位 mm），未测。保留地坪最低梁底待测，切口协商待确认。</p>`),
    ...drawings.map((d) => section(d.title, `<p>${e(d.note)}</p>${d.svg}`)),
    section("整体院坪平面 · 自家与邻居", `<p>北向上、东向右。只画主辅楼与门厅外轮廓，不画室内布局。前院外沿取当前圆弧；邻居面宽13000、木房8800＋水泥2000、水泥外约9500院坪（mm）为口述占位。尺寸供建成后余量核对，非测绘。</p>${courtyardSitePlan()}`),
    ...floors.map((f, i) => section(`${f.name}家具与使用讨论 · ${bedroomSummary(i)}`, `<p>南向上、西向右（门头朝下）。房间标注墙线面积与净空面积（㎡示意）。家具虚线按600 mm留位，使用方向和实际要求待设计，非通行校核。</p>${floorPlan(i, true, view.balcony, { useZones: true, dining: "full" })}`)),
    section("餐厅日常示意 · 待比较", `<p>日常示意仅使用原小桌6座；圆桌及12椅暂收起，不修改3D基准。收纳位置、活动家具形式和厨房服务动线未定。本图册的一层满座图是双桌18座情景，仍偏紧。</p>${floorPlan(0, true, view.balcony, { inside: false, useZones: false, dining: "daily" })}`),
    section("房间尺寸口径", roomSchedule()),
    section("模型门窗洞口", openingSchedule()),
    section("编号议题与讨论记录", `<p>“已记录意见”只表示已记下讨论，专业确认仍须有图纸与依据。</p>${designIssues.map((issue) => {
      const note = session.notes[issue.id];
      return `<article><small>${e(issue.phase)} · ${e(note?.status ?? "未讨论")}</small><h3>${issue.id} · ${e(issue.title)}</h3><p>当前：${e(issue.current)}</p><p>下一步：${e(issue.action)}</p><p>建议负责：${e(issue.owner)}<br/>所需成果：${e(issue.output)}</p><p>本次负责人：${e(note?.owner || "待安排")}；下次资料日期：${e(note?.due || "待约定")}</p><div class="note">${e(note?.body || "尚未记录意见")}</div></article>`;
    }).join("")}`),
    section("当前视图与快照索引", `<p>当前视图：${e(meetingTabLabels[view.tab])}／${e(cameraViewLabels[view.camera])}，${view.level < 0 ? "院坪总图" : floors[view.level].name}；${roofStyleLabels[view.roofStyle]}；自家院坪：${courtyardFinishLabels[view.courtyardFinish]}，邻居院坪：${courtyardFinishLabels[view.neighborCourtyardFinish]}。快照JSON需在本模型“设计沟通”导入，才能恢复机位、图层与探索参数；跨版本仅恢复参数，不还原旧几何。</p>${image?.startsWith("data:image/png;base64,") ? `<img class="model-image" src="${image}" alt="带版本与未核状态的当前模型截图"/>` : ""}<ul>${session.snapshots.map((s) => `<li>${e(s.title)} · ${e(s.revision)} · ${e(s.createdAt)}；${roofStyleLabels[s.view.roofStyle]}；分水${s.view.fenShui.toFixed(1)}／道路${formatMm(s.view.roadY)}／坡长${formatMm(s.view.rampLength)}（mm）；自家${courtyardFinishLabels[s.view.courtyardFinish]}／邻居${courtyardFinishLabels[s.view.neighborCourtyardFinish]}</li>`).join("") || "<li>尚无命名快照</li>"}</ul>`),
    section("事实依据与专业回交", `<p>记录日期是本版整理日期；“用户提供”不等于已实测或已审批。待取得测量及专业成果后，注明文件、确认人和日期再更新模型。</p>${facts.map((f) => `<article><h3>${e(f.label)} · ${e(f.value)}</h3><small>${e(f.source)}</small><p>${e(f.note)}</p></article>`).join("")}<h2>请设计公司分阶段回交</h2><ol><li>实测总平面、界址和标高、邻房道路关系、地勘及当地建设条件。</li><li>净尺寸家具平面、四向立面、关键剖面与未决问题备选。</li><li>初步结构梁底、挡土基础、排水、烟道及主要设备协调成果。</li><li>明确设计范围、修改轮次、施工图专业、现场服务和CAD／BIM／PDF格式。</li></ol>`),
  ];
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>安化山居-${e(projectMeta.revision)}-设计沟通图册</title><style>body{font:15px system-ui,sans-serif;color:#293e35;background:#edf0e9;margin:0}.book-page{box-sizing:border-box;max-width:1120px;background:white;margin:24px auto;padding:36px}.book-page>header,.book-page>footer{display:flex;justify-content:space-between;font-size:12px;color:#69756c;border-bottom:1px solid #dce3d9;padding:8px 0}.book-page>footer{border:0;border-top:1px solid #dce3d9;margin-top:24px}h1{font-size:25px}h2{font-size:20px}.paper{fill:white}.model-image{max-width:100%}.plan-shared-body{display:grid;gap:5px}.plan-shared-dimensions{font-size:12px;margin:12px 0}.plan-sheets{display:grid;gap:18px}.plan-sheets-split{grid-template-columns:2fr 1fr}.plan-sheet{min-width:0}.plan-sheet h3{font-size:15px}.dim-mm{font-size:250px;fill:#82551d}.dim-unit{font-size:190px}.dim-ext{fill:none;stroke:#c29b6a;stroke-width:15}.dim-tick-slash{fill:none;stroke:#82551d;stroke-width:25}.floor-svg{width:100%;max-height:none;background:#fbfaf6}.floor-svg text{font-family:system-ui,sans-serif;fill:#324b3d}.room-name{font-size:290px}.room-size{font-size:240px}.dim-label{font-size:300px}.footnote{font-size:200px}.outside-wall{fill:none;stroke:#51614e}.bearing-wall{fill:none;stroke:#51614e}.partition{fill:none;stroke:#9a9a9a}.wall-role-legend{font-size:220px;fill:#5a6558}.door-gap{stroke:#fbfaf6}.door-swing{fill:none;stroke:#899780;stroke-width:35}.window{stroke:#6c9aa5;stroke-width:40}.dim-line{fill:none;stroke:#8c978a;stroke-width:45}.step-line{fill:none;stroke:#899780;stroke-width:25}.balustrade{fill:none;stroke:#9caeaa;stroke-width:70}.furniture{fill:#f6f3e9;stroke:#9ba28e;stroke-width:25}.pillow{fill:#d9e0ce}.furniture-label{font-size:200px}.clearance,.use-zone{fill:none;stroke:#b47b39;stroke-width:35;stroke-dasharray:120 80}.inside-label{font-size:200px;fill:#6d7969}.daily-stored{opacity:.3}.book-toolbar{position:sticky;top:0;background:#365a48;color:white;padding:12px;text-align:center}.book-toolbar button{padding:10px 18px;cursor:pointer}@page{size:A4 landscape;margin:12mm}@media print{body{background:white}.book-toolbar{display:none}.book-page{max-width:none;margin:0;padding:0;break-after:page}.book-page:last-of-type{break-after:auto}article,tr{break-inside:avoid}.technical-svg{max-height:150mm}.floor-svg{height:128mm;width:100%;break-inside:avoid}.model-image{display:block;width:100%;max-height:108mm;object-fit:contain;break-inside:avoid}body{font-size:12px;line-height:1.5}.book-page h1{font-size:20px;margin:12px 0}.book-page h2{font-size:16px}.book-page h3{font-size:14px}.book-page p{line-height:1.55;margin:8px 0}.book-page article{padding:10px 12px;margin:9px 0}.book-page .note{padding:8px}.book-page th,.book-page td{padding:6px 8px;font-size:11px}.book-page>header,.book-page>footer{font-size:10px;padding:5px 0}.book-page>footer{margin-top:12px}h1,h2,h3{break-after:avoid}p{orphans:3;widows:3}}${tableStyles}${drawingStyles}@media print{.book-page>footer{break-before:avoid}.book-page>article:last-of-type{break-after:avoid}}</style><body><div class="book-toolbar">离线沟通图册 · 可保存与转发　<button onclick="window.print()">打印／另存为PDF</button>　<span>长表与议题页可能续页；页组编号用于索引。</span></div>${pages.join("")}<script type="application/json" id="unresolved-conditions">${JSON.stringify(unresolvedConditions)}</script></body></html>`;
}
