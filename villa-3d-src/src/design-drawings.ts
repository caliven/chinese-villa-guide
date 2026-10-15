import { construction, courtyardFront, floors, frontElevation, site } from "./data";
import { contourAt } from "./contours";
import { roofPitch } from "./architecture";
import { facades } from "./facades";
import { garageLayout } from "./garage-layout";
import { assessVehicleRoute, routeRanges, vehicleRoute } from "./vehicle-route";
import { entranceMetrics, floorFinish, stairMetrics } from "./design-data";
import { escapeHtml as e, projectMeta } from "./project-meta";

export interface DrawingOptions { fenShui: number; roadY: number; rampLength: number }
export interface DesignDrawing { id: string; title: string; note: string; svg: string }
export const elevation = (y: number) => `${y >= 0 ? "+" : "−"}${Math.abs(y).toFixed(3)}`;
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
  return { id, title, note, svg: `<svg class="technical-svg" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${e(title)}。${e(note)}" viewBox="0 0 1000 470"><title>${e(title)}</title><desc>${e(note)}</desc>${rect(0, 0, 1000, 470, "paper")}${text(30, 32, `${id}  ${title}`, "title")}${text(970, 30, "关系示意 · 纵横比例不同 · 非施工图", "small muted", "end")}${content}${path("M30 430 H970", "dimension")}${text(30, 449, `${projectMeta.revision} · ${projectMeta.date} · 单位m · ${projectMeta.datum}`, "small muted")}${text(30, 466, note, "small warn-text")}</svg>` };
}

function siteSection(options: DrawingOptions) {
  const ridge = floors[2].y + floors[2].height + roofPitch(options.fenShui).mainRise;
  const scaleY = Math.min(18, 210 / ridge);
  const x = (z: number) => 60 + (z + 13) * 24, y = (h: number) => 310 - h * scaleY;
  const front = contourAt(courtyardFront, site.main.x + site.main.w / 2);
  let content = text(60, 60, "北 N ←  ·  示意位置：主楼中跨  ·  → 南 S", "small muted");
  content += rect(x(front), y(0), x(-1) - x(front), y(site.garageFloor) - y(0), "pending");
  content += path(`M${x(-13)} ${y(site.garageFloor - site.frontFieldDrop)} H${x(front)} V${y(0)} H${x(-1)} M${x(9)} ${y(0)} H${x(10.8)} V${y(site.rearField)} H${x(16)}`, "line");
  content += rect(x(-1), y(7.2), x(9) - x(-1), y(0) - y(7.2), "wall");
  content += rect(x(.8), y(10.5), x(9) - x(.8), y(7.2) - y(10.5), "wall");
  content += path(`M${x(-1)} ${y(10.5)} H${x(.8)} V${y(7.2)} H${x(-1)}`, "guide");
  for (let i = 0; i < 3; i++) {
    const h = floorFinish(i), left = i === 2 ? .8 : -1;
    content += rect(x(left), y(h), x(9) - x(left), construction.floorSlab * scaleY, "wall");
    content += text(x(left) + 10, y(h) - 8, `${floors[i].name}完成面 ${elevation(h)}`, "small");
  }
  content += path(`M${x(0)} ${y(10.5)} L${x(4.9)} ${y(ridge)} L${x(9.55)} ${y(10.5)} Z`, "roof");
  content += text(x(4.9), y(ridge) - 12, `屋脊 ${elevation(ridge)} · 分水${options.fenShui.toFixed(1)}`, "small", "middle");
  content += text(x(front) + 10, y(-1.2), "地库体量／梁底待设计", "small warn-text");
  content += path(`M${x(front)} ${y(site.garageFloor)} H${x(-1)}`, "line");
  content += text(x(front), y(site.garageFloor) + 20, `库底 ${elevation(site.garageFloor)} · 示意`, "small");
  content += text(x(10.8) + 8, y(2.5) - 10, "屋后田 +2.500 · 待联测", "small");
  content += dimension(x(9), x(10.8), 385, "屋后留1.8");
  content += text(800, 103, "待补测／设计", "warn-text");
  ["真实界址及高程基准", "保留梁底、挡墙及基础", "截排水、防水及支护", "屋面／露台排水去向", "邻房及施工保护条件"].forEach((v, i) => { content += text(800, 130 + 25 * i, v, "small"); });
  content += text(60, 407, "田坎轮廓与体量作关系表达，省略装饰、官帽遮挡及构造层；不是连续实测地形断面。", "small muted");
  return sheet("S01", "场地南北关系", "院坪及地库、田面均沿用当前示意标高；绝对高程与结构条件待测／待设计。", content);
}

function garageProfile(options: DrawingOptions) {
  const assessment = assessVehicleRoute(options.roadY, options.rampLength);
  const min = Math.min(site.garageFloor, ...assessment.poses.map((p) => p.y)) - .15;
  const max = Math.max(...assessment.poses.map((p) => p.y + site.vehicle.height)) + .15;
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
  content += text(70, 396, "红带：平面柱墙潜在冲突／越出示意通道；蓝带按车高1.800m示意，纵横比例不同。", "small risk-text");
  for (const t of [0, .25, .5, .75, 1]) {
    content += path(`M${x(t)} 335 v6`, "dimension") + text(x(t), 354, `${Math.round(t * 100)}%`, "small", "middle");
  }
  content += text(70, 418, `按原路线平面弧长展开（约${vehicleRoute.getLength().toFixed(1)}m）；当前接入示意值 ${options.roadY.toFixed(2)}m、坡长${options.rampLength.toFixed(1)}m。`, "small muted");
  return sheet("S02", "地库路线标高展开", "不是整车纵向扫掠：含镜、转弯、俯仰、前后悬、底盘、驶出及第二辆车仍待校核，通行未确认。", content);
}

function stairSection() {
  const metrics = stairMetrics();
  const y = (h: number) => 370 - h * 34;
  let content = text(50, 65, "两跑沿行进方向展开，横向表示踏面累计长度；平台与楼层不在同一竖向剖切面。", "small muted");
  metrics.forEach((m, index) => {
    let px = 65 + index * 455;
    let d = `M${px} ${y(m.from)}`;
    for (let i = 1; i <= m.count; i++) {
      d += ` V${y(m.from + i * m.riser)}`;
      if (i < m.count) {
        px += (i === m.count / 2 ? m.landing : m.tread) * 58;
        d += ` H${px}`;
      }
    }
    content += path(d, "line");
    content += path(`M${65 + index * 455} ${y(m.from)} h-20 M${px} ${y(m.to)} h35`, "wall");
    content += text(65 + index * 455, 395, `${m.label} · 完成面高差${m.rise.toFixed(2)}m`, "small");
    content += text(65 + index * 455, 417, `${m.count}高差分段 × ${(m.riser * 1000).toFixed(1)}mm；踏面${m.tread.toFixed(2)}m`, "small");
    content += text(65 + index * 455, y(m.from) - 15, elevation(m.from), "small");
    content += text(px, y(m.to) - 15, elevation(m.to), "small");
  });
  content += rect(55, 85, 370, 90, "pending");
  content += text(70, 110, "净高／扶手后净宽尚无结论", "warn-text");
  content += text(70, 135, "示意梯段宽1.05m、平台进深0.80m", "small");
  content += text(70, 158, "洞口3.35×2.50m；梁底、装修及起终步待设计", "small");
  return sheet("S03", "楼梯连续高差展开", "首层完成面已抬高0.450m；展开图按现有20分段示意，不是踏步施工排布或碰头校核结论。", content);
}

function entranceSection() {
  const m = entranceMetrics();
  let content = text(50, 64, "A · 主辅楼连接处沿东西展开（竖向放大）", "small muted");
  const y = (h: number) => 215 - h * 160;
  content += rect(100, y(floorFinish(0)), 235, 22, "wall");
  content += rect(335, y(m.connectionY), 150, 14, "wall");
  content += rect(485, y(floorFinish(0)), 330, 22, "wall");
  content += path(`M335 ${y(floorFinish(0))} V${y(m.connectionY)} M485 ${y(floorFinish(0))} V${y(m.connectionY)}`, "risk");
  content += text(115, 124, `辅楼完成面 ${elevation(floorFinish(0))}`, "small");
  content += text(530, 124, `主楼完成面 ${elevation(floorFinish(0))}`, "small");
  content += text(330, 249, `连接地坪 ${elevation(m.connectionY)} · 两端各差${m.connectionRise.toFixed(3)}m`, "small warn-text");
  content += dimension(335, 485, 280, "墙间1.5m");
  content += text(100, 310, "此处尚未表达连续抬高平台、踏步或合适坡道；门洞画通不等于实际平顺通行。", "small warn-text");
  content += text(50, 344, "B · 门厅向北外伸控制线（从主楼前墙北外皮起算，非面积认定）", "small muted");
  const z = (d: number) => 165 + d * 170;
  content += path(`M${z(0)} 367 H${z(m.steps)} M${z(0)} 355 V400`, "line");
  for (const [d, label] of [[m.projection, "楼板2.00"], [m.column, "柱2.60"], [m.platform, "平台2.75"], [m.steps, "踏步3.35"]] as [number, string][]) {
    content += path(`M${z(d)} 360 V383`, "dimension");
    content += text(z(d), d === m.platform ? 416 : 399, label, "small", "middle");
  }
  content += text(100, 393, "前墙0", "small");
  content += text(845, 145, "侧坡道", "warn-text");
  content += text(845, 172, `名义0.45／${m.rampRun.toFixed(1)}m`, "small");
  content += text(845, 197, `约${m.rampGrade.toFixed(1)}% · 待核`, "small warn-text");
  content += text(845, 224, "防滑、门槛、排水", "small");
  content += text(845, 248, "扶手及雨棚待设计", "small");
  return sheet("S04", "入口与主辅楼连接高差", "沿用当前几何暴露高差问题，不新增未经确定的平台、坡道或无障碍通行结论。", content);
}

function northElevation(options: DrawingOptions) {
  const pitch = roofPitch(options.fenShui);
  const scaleY = Math.min(21, 255 / (10.5 + pitch.mainRise));
  const x = (east: number) => 855 - east * 35, y = (h: number) => 350 - h * scaleY;
  let content = text(50, 65, "朝北看房：左为东 E，右为西 W · 窗洞取自当前立面数据", "small muted");
  content += rect(x(site.main.x + site.main.w), y(10.5), site.main.w * 35, 10.5 * scaleY, "wall");
  content += rect(x(site.annex.x + site.annex.w), y(site.annex.height), site.annex.w * 35, site.annex.height * scaleY, "wall");
  for (const [index, base] of [0, 1, 2, 3].map((index) => [index, index === 3 ? 0 : floors[index].y])) {
    const north = facades(index).find((wall) => Math.abs(wall.a[1] - wall.b[1]) < .01)!;
    north.openings.filter((o) => !o.open).forEach((o) => {
      const cx = north.a[0] + o.at;
      content += rect(x(cx + o.w / 2), y(base + o.sill + o.h), o.w * 35, o.h * scaleY, "glass");
    });
  }
  const roof = (left: number, right: number, eave: number, rise: number, run: number) => path(`M${x(right)} ${y(eave)} L${x(right - run)} ${y(eave + rise)} H${x(left + run)} L${x(left)} ${y(eave)} Z`, "roof");
  content += roof(site.main.x - .8, site.main.x + site.main.w + .8, 10.5, pitch.mainRise, pitch.mainRun);
  content += roof(site.annex.x - .55, site.annex.x + site.annex.w + .55, 3.6, pitch.annexRise, pitch.annexRun);
  for (const post of frontElevation.balustradePosts.slice(1, 3))
    content += rect(x(post.x + frontElevation.porticoColumnDepth / 2), y(7.2), frontElevation.porticoColumnDepth * 35, 7.2 * scaleY, "wall");
  for (const h of [0, .45, 3.6, 7.2, 10.5])
    content += path(`M55 ${y(h)} H950`, "guide");
  [[3.6, "二层 +3.600"], [7.2, "三层 +7.200"], [10.5, "檐口 +10.500"]].forEach(([h, label]) => { content += text(785, y(Number(h)) - 6, String(label), "small"); });
  content += text(785, 334, "首层 +0.450", "small") + text(785, 365, "院坪 ±0.000", "small");
  content += dimension(x(21.1), x(0), 400, "0.8 ＋ 主楼13.5 ＋ 子孙道1.5 ＋ 辅楼4.5 ＋ 0.8 ＝ 21.1m");
  const m = entranceMetrics();
  content += text(50, 420, `前墙向北控制线：门厅楼板${m.projection.toFixed(2)}／柱北外皮${m.column.toFixed(2)}／平台${m.platform.toFixed(2)}／最外踏步${m.steps.toFixed(2)}m。`, "small");
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
