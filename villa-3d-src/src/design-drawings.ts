import { recessedPortico, porticoWallZ, mirroredBuildings } from "./building-variants";
import { construction, courtyardFront, floors, frontElevation, site, stairLayout } from "./data";
import { formatMm, toM } from "./units";
import { contourAt } from "./contours";
import { mainRoofFootprint, roofPitch } from "./architecture";
import { facades } from "./facades";
import { garageLayout } from "./garage-layout";
import { assessVehicleRoute, routeRanges, vehicleRoute } from "./vehicle-route";
import { entranceMetrics, floorFinish, stairMetrics } from "./design-data";
import { escapeHtml as e, projectMeta } from "./project-meta";

export interface DrawingOptions { fenShui: number; roadY: number; rampLength: number }
export interface DesignDrawing { id: string; title: string; note: string; svg: string }
/** 标高（mm 整数，带正负号）。 */
export const elevation = (y: number) => `${y >= 0 ? "+" : "−"}${formatMm(Math.abs(y))}`;
const text = (x: number, y: number, value: string, cls = "", anchor = "start") => `<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}">${e(value)}</text>`;
const path = (d: string, cls: string) => `<path d="${d}" class="${cls}"/>`;
const rect = (x: number, y: number, w: number, h: number, cls: string) => `<rect x="${x}" y="${y}" width="${Math.max(0, w)}" height="${Math.max(0, h)}" class="${cls}"/>`;
const dimension = (x0: number, x1: number, y: number, label: string) => path(`M${x0} ${y - 5} v10 M${x0} ${y} H${x1} M${x1} ${y - 5} v10`, "dimension") + text((x0 + x1) / 2, y - 9, label, "small", "middle");
export const drawingStyles = `
  .technical-svg{background:#fff;width:100%;height:auto;font:14px system-ui,sans-serif;color:#293e35}
  .technical-svg .paper{fill:white}.technical-svg text{fill:#293e35}.technical-svg .small{font-size:12px}.technical-svg .title{font-size:18px;font-weight:700}
  .technical-svg .muted{fill:#69756c}.technical-svg .warn-text{fill:#9a561f}.technical-svg .risk-text{fill:#a33a35}
  .technical-svg .wall{fill:#f0eee4;stroke:#536c60;stroke-width:2}.technical-svg .ground{fill:#e4e9da;stroke:#829276;stroke-width:1.5}
  .technical-svg .line{fill:none;stroke:#405b4d;stroke-width:2}.technical-svg .guide{fill:none;stroke:#adb7ac;stroke-width:1;stroke-dasharray:5 4}
  .technical-svg .dimension{fill:none;stroke:#8c978a;stroke-width:1}.technical-svg .pending{fill:#f7dfb6;fill-opacity:.6;stroke:#b87e3f;stroke-dasharray:6 4}
  .technical-svg .vehicle{fill:#579cbc;fill-opacity:.22;stroke:#317c9b;stroke-width:1.5}.technical-svg .risk{fill:#d36f66;fill-opacity:.25;stroke:#b54d45;stroke-width:2}
  .technical-svg .glass{fill:#c8e1e5;stroke:#719ba2;stroke-width:1}.technical-svg .roof{fill:#596d66;stroke:#334c40;stroke-width:1.5}
`;
function sheet(id: string, title: string, note: string, content: string): DesignDrawing {
  return { id, title, note, svg: `<svg class="technical-svg" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${e(title)}。${e(note)}" viewBox="0 0 1000 470"><title>${e(title)}</title><desc>${e(note)}</desc>${rect(0, 0, 1000, 470, "paper")}${text(30, 32, `${id}  ${title}`, "title")}${text(970, 30, "关系示意 · 纵横比例不同 · 非施工图", "small muted", "end")}${content}${path("M30 430 H970", "dimension")}${text(30, 449, `${projectMeta.revision} · ${projectMeta.date} · 长度单位毫米 · ${projectMeta.datum}`, "small muted")}${text(30, 466, note, "small warn-text")}</svg>` };
}

function siteSection(options: DrawingOptions) {
  const ridge = floors[2].y + floors[2].height + roofPitch(options.fenShui).mainRise;
  // 绘图比例按 px／m 计，输入均为 mm。
  const scaleY = Math.min(18, 210 / toM(ridge));
  const x = (z: number) => 60 + (toM(z) + 13) * 24, y = (h: number) => 310 - toM(h) * scaleY;
  const front = contourAt(courtyardFront, site.main.x + site.main.w / 2);
  const wallFront = porticoWallZ();
  const wallRear = site.main.z + site.main.d;
  const thirdFront = wallFront + site.setback;
  let content = text(60, 60, "北 N ←  ·  示意位置：主楼中跨  ·  → 南 S", "small muted");
  content += rect(x(front), y(0), x(wallFront) - x(front), y(site.garageFloor) - y(0), "pending");
  content += path(`M${x(-13000)} ${y(site.garageFloor - site.frontFieldDrop)} H${x(front)} V${y(0)} H${x(wallFront)} M${x(wallRear)} ${y(0)} H${x(site.oldDepth)} V${y(site.rearField)} H${x(16000)}`, "line");
  content += rect(x(wallFront), y(7200), x(wallRear) - x(wallFront), y(0) - y(7200), "wall");
  content += rect(x(thirdFront), y(10500), x(wallRear) - x(thirdFront), y(7200) - y(10500), "wall");
  if (site.setback > 0) content += path(`M${x(wallFront)} ${y(10500)} H${x(thirdFront)} V${y(7200)} H${x(wallFront)}`, "guide");
  for (let i = 0; i < 3; i++) {
    const h = floorFinish(i), left = i === 2 ? thirdFront : wallFront;
    content += rect(x(left), y(h), x(wallRear) - x(left), toM(construction.floorSlab) * scaleY, "wall");
    content += text(x(left) + 10, y(h) - 8, `${floors[i].name}完成面 ${elevation(h)}`, "small");
  }
  content += path(`M${x(wallFront + 1000)} ${y(10500)} L${x((wallFront + wallRear) / 2)} ${y(ridge)} L${x(wallRear + 550)} ${y(10500)} Z`, "roof");
  content += text(x((wallFront + wallRear) / 2), y(ridge) - 12, `屋脊 ${elevation(ridge)} · 分水${options.fenShui.toFixed(1)}`, "small", "middle");
  content += text(x(front) + 10, y(-1200), "地库体量／梁底待设计", "small warn-text");
  content += path(`M${x(front)} ${y(site.garageFloor)} H${x(wallFront)}`, "line");
  content += text(x(front), y(site.garageFloor) + 20, `库底 ${elevation(site.garageFloor)} · 示意`, "small");
  content += text(x(site.oldDepth) + 8, y(site.rearField) - 10, `屋后田 ${elevation(site.rearField)} · 待联测`, "small");
  content += dimension(x(wallRear), x(site.oldDepth), 385, `屋后留${formatMm(site.rearGap)}`);
  content += text(800, 103, "待补测／设计", "warn-text");
  ["真实界址及高程基准", "保留梁底、挡墙及基础", "截排水、防水及支护", "屋面／露台排水去向", "邻房及施工保护条件"].forEach((v, i) => { content += text(800, 130 + 25 * i, v, "small"); });
  content += text(60, 407, "田坎轮廓与体量作关系表达，省略装饰、官帽遮挡及构造层；不是连续实测地形断面。", "small muted");
  return sheet("S01", "场地南北关系", "院坪及地库、田面均沿用当前示意标高；绝对高程与结构条件待测／待设计。", content);
}

function garageProfile(options: DrawingOptions) {
  const assessment = assessVehicleRoute(options.roadY, options.rampLength);
  const min = Math.min(site.garageFloor, ...assessment.poses.map((p) => p.y)) - 150;
  const max = Math.max(...assessment.poses.map((p) => p.y + site.vehicle.height)) + 150;
  const x = (t: number) => 70 + 850 * t, y = (h: number) => 300 - (h - min) / (max - min) * 170;
  const points = assessment.poses.map((p) => `${x(p.progress)},${y(p.y)}`);
  const top = assessment.poses.slice().reverse().map((p) => `${x(p.progress)},${y(p.y + site.vehicle.height)}`);
  let content = "";
  for (const [from, to] of routeRanges(assessment.cells, (c) => c.underDeck))
    content += rect(x(from), 55, x(to) - x(from), 295, "pending");
  content += text(495, 78, "橙区：保留地坪投影下方 · 实际最低梁底未知", "warn-text", "middle");
  content += text(495, 101, "不画假定梁底线，不推算车顶余量；拟切口仍待协商", "small warn-text", "middle");
  content += `<polygon points="${[...points, ...top].join(" ")}" class="vehicle"/>`;
  content += path(`M${points.join(" L")}`, "line");
  content += text(78, y(assessment.poses[0].y) + 24, `道路段起点 ${elevation(assessment.poses[0].y)} · 模型值`, "small");
  content += text(920, y(site.garageFloor) + 20, `库底 ${elevation(site.garageFloor)}`, "small", "end");
  for (const [from, to] of routeRanges(assessment.cells, (c) => c.outside || c.obstacles.length > 0))
    content += rect(x(from), 367, x(to) - x(from), 8, "risk");
  content += text(70, 396, `红带：平面柱墙潜在冲突／越出示意通道；蓝带按车高${formatMm(site.vehicle.height)}示意，纵横比例不同。`, "small risk-text");
  for (const t of [0, .25, .5, .75, 1]) {
    content += path(`M${x(t)} 335 v6`, "dimension") + text(x(t), 354, `${Math.round(t * 100)}%`, "small", "middle");
  }
  content += text(70, 418, `按原路线平面弧长展开（约${formatMm(vehicleRoute.getLength())}）；当前接入示意值 ${formatMm(options.roadY)}、坡长${formatMm(options.rampLength)}。`, "small muted");
  return sheet("S02", "地库路线标高展开", "不是整车纵向扫掠：含镜、转弯、俯仰、前后悬、底盘、驶出及第二辆车仍待校核，通行未确认。", content);
}

function stairSection() {
  const metrics = stairMetrics();
  const y = (h: number) => 370 - toM(h) * 34;
  let content = text(50, 65, "两跑沿行进方向展开，横向表示踏面累计长度；平台与楼层不在同一竖向剖切面。", "small muted");
  metrics.forEach((m, index) => {
    let px = 65 + index * 455;
    let d = `M${px} ${y(m.from)}`;
    for (let i = 1; i <= m.count; i++) {
      d += ` V${y(m.from + i * m.riser)}`;
      if (i < m.count) {
        px += toM(i === m.count / 2 ? m.landing : m.tread) * 58;
        d += ` H${px}`;
      }
    }
    content += path(d, "line");
    content += path(`M${65 + index * 455} ${y(m.from)} h-20 M${px} ${y(m.to)} h35`, "wall");
    content += text(65 + index * 455, 395, `${m.label} · 完成面高差${formatMm(m.rise)}`, "small");
    content += text(65 + index * 455, 417, `${m.count}高差分段 × ${m.riser.toFixed(1)}；踏面${formatMm(m.tread)}`, "small");
    content += text(65 + index * 455, y(m.from) - 15, elevation(m.from), "small");
    content += text(px, y(m.to) - 15, elevation(m.to), "small");
  });
  content += rect(55, 85, 370, 90, "pending");
  content += text(70, 110, "净高／扶手后净宽尚无结论", "warn-text");
  content += text(70, 135, `示意梯段宽${formatMm(stairLayout.flight)}、平台进深${formatMm(stairLayout.landing)}`, "small");
  content += text(70, 158, `洞口${formatMm(stairLayout.hole.w)}×${formatMm(stairLayout.hole.d)}；梁底、装修及起终步待设计`, "small");
  return sheet("S03", "楼梯连续高差展开", `首层完成面已抬高${formatMm(site.entranceRise)} mm；展开图按现有20分段示意，不是踏步施工排布或碰头校核结论。`, content);
}

function entranceSection() {
  const m = entranceMetrics();
  let content = text(50, 64, "A · 主辅楼连接处沿东西展开（竖向放大）", "small muted");
  const y = (h: number) => 215 - toM(h) * 160;
  content += rect(100, y(floorFinish(0)), 235, 22, "wall");
  content += rect(335, y(m.connectionY), 150, 14, "wall");
  content += rect(485, y(floorFinish(0)), 330, 22, "wall");
  content += path(`M335 ${y(floorFinish(0))} V${y(m.connectionY)} M485 ${y(floorFinish(0))} V${y(m.connectionY)}`, "risk");
  content += text(115, 124, `${mirroredBuildings() ? "主楼" : "辅楼"}完成面 ${elevation(floorFinish(0))}`, "small");
  content += text(530, 124, `${mirroredBuildings() ? "辅楼" : "主楼"}完成面 ${elevation(floorFinish(0))}`, "small");
  content += text(330, 249, `连接地坪 ${elevation(m.connectionY)} · 两端各差${formatMm(m.connectionRise)}`, "small warn-text");
  content += dimension(335, 485, 280, `墙间${formatMm(site.lane)}`);
  content += text(100, 310, "此处尚未表达连续抬高平台、踏步或合适坡道；门洞画通不等于实际平顺通行。", "small warn-text");
  content += text(50, 344, recessedPortico() ? "B · 凹入门厅控制线（向北为正、向南内退为负，非面积认定）" : "B · 门厅向北外伸控制线（从主楼前墙北外皮起算，非面积认定）", "small muted");
  const z = (d: number) => 165 + toM(d) * 170;
  content += path(`M${z(0)} 367 H${z(m.steps)} M${z(0)} 355 V400`, "line");
  for (const [d, label] of [[m.projection, `楼板${formatMm(m.projection)}`], [m.column, `柱${formatMm(m.column)}`], [m.platform, `平台${formatMm(m.platform)}`], [m.steps, `踏步${formatMm(m.steps)}`]] as [number, string][]) {
    content += path(`M${z(d)} 360 V383`, "dimension");
    content += text(z(d), d === m.platform ? 416 : 399, label, "small", "middle");
  }
  content += text(100, 393, "前墙0", "small");
  if (recessedPortico()) {
    content += text(845, 145, "凹入式门厅", "small");
    content += text(845, 172, "左右侧坡道已取消", "small");
    content += text(845, 197, "保留正面三步台阶", "small");
  } else {
    content += text(845, 145, "侧坡道", "warn-text");
    content += text(845, 172, `名义${formatMm(site.entranceRise)}／${formatMm(m.rampRun)}`, "small");
    content += text(845, 197, `约${m.rampGrade.toFixed(1)}% · 待核`, "small warn-text");
  }
  content += text(845, 224, "防滑、门槛、排水", "small");
  content += text(845, 248, "扶手及雨棚待设计", "small");
  return sheet("S04", "入口与主辅楼连接高差", "沿用当前几何暴露高差问题，不新增未经确定的平台、坡道或无障碍通行结论。", content);
}

function northElevation(options: DrawingOptions) {
  const pitch = roofPitch(options.fenShui);
  const scaleY = Math.min(21, 255 / (10.5 + toM(pitch.mainRise)));
  const x = (east: number) => 855 - toM(east) * 35, y = (h: number) => 350 - toM(h) * scaleY;
  let content = text(50, 65, "朝北看房：左为东 E，右为西 W · 窗洞取自当前立面数据", "small muted");
  content += rect(x(site.main.x + site.main.w), y(10500), toM(site.main.w) * 35, 10.5 * scaleY, "wall");
  content += rect(x(site.annex.x + site.annex.w), y(site.annex.height), toM(site.annex.w) * 35, toM(site.annex.height) * scaleY, "wall");
  for (const [index, base] of [0, 1, 2, 3].map((index) => [index, index === 3 ? 0 : floors[index].y])) {
    const north = facades(index).find((wall) => Math.abs(wall.a[1] - wall.b[1]) < 10)!;
    north.openings.filter((o) => !o.open).forEach((o) => {
      const cx = north.a[0] + Math.sign(north.b[0] - north.a[0]) * o.at;
      content += rect(x(cx + o.w / 2), y(base + o.sill + o.h), toM(o.w) * 35, toM(o.h) * scaleY, "glass");
    });
  }
  const roof = (left: number, right: number, eave: number, rise: number, run: number) => path(`M${x(right)} ${y(eave)} L${x(right - run)} ${y(eave + rise)} H${x(left + run)} L${x(left)} ${y(eave)} Z`, "roof");
  const mainRoof = mainRoofFootprint();
  content += roof(mainRoof.x, mainRoof.x + mainRoof.w, 10500, pitch.mainRise, pitch.mainRun);
  content += roof(site.annex.x - 550, site.annex.x + site.annex.w + 550, 3600, pitch.annexRise, pitch.annexRun);
  for (const post of frontElevation.balustradePosts.slice(1, 3))
    content += rect(x(post.x + frontElevation.porticoColumnDepth / 2), y(7200), toM(frontElevation.porticoColumnDepth) * 35, 7.2 * scaleY, "wall");
  for (const h of [0, site.entranceRise, 3600, 7200, 10500])
    content += path(`M55 ${y(h)} H950`, "guide");
  [[3600, `二层 ${elevation(3600)}`], [7200, `三层 ${elevation(7200)}`], [10500, `檐口 ${elevation(10500)}`]].forEach(([h, label]) => { content += text(785, y(Number(h)) - 6, String(label), "small"); });
  content += text(785, 334, `首层 ${elevation(site.entranceRise)}`, "small") + text(785, 365, "院坪 ±0", "small");
  content += dimension(x(21000), x(0), 400, `主楼${site.main.w} ＋ 子孙道${site.lane} ＋ 辅楼${site.annex.w} ＋ 两侧余量 ＝ ${site.width}`);
  const m = entranceMetrics();
  content += text(50, 420, `前墙向北控制线：门厅楼板${formatMm(m.projection)}／柱北外皮${formatMm(m.column)}／平台${formatMm(m.platform)}／最外踏步${formatMm(m.steps)}。`, "small");
  return sheet("E01", "北立面与控制尺寸", "正投影尺寸关系示意，纵横比例不同；省略官帽、栏杆、装饰与遮挡。待设计师回交完整四向立面。", content);
}

export function designDrawings(options: DrawingOptions) {
  return [siteSection(options), garageProfile(options), stairSection(), entranceSection(), northElevation(options)];
}

export const unresolvedConditions = {
  roadSurveyElevation: null,
  lowestRetainedSoffitElevation: garageLayout.retainedDeck.soffitY,
  cutAgreementConfirmed: garageLayout.proposedCut.confirmed,
  stairHeadroom: null,
  structuralCapacity: null,
  drainageDestination: null,
};
