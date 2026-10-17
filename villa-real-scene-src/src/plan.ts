import {
  floors,
  site,
  frontElevation,
  stairLayout,
  circulation,
  annexRooms,
  annexFurniture,
  annexPartitions,
  type Room,
  type Wall,
  type Furniture,
} from "./data";
import { facades, type Facade } from "./facades";

const colors: Record<Room["kind"], string> = {
  bed: "#e1e9de",
  living: "#eee7d6",
  hall: "#f0ecdf",
  bath: "#dfe9e9",
  stair: "#e3e3dc",
  kitchen: "#e9ded0",
  dining: "#eee3ce",
  store: "#e5dfd1",
  void: "url(#void)",
};
const text = (x: number, y: number, content: string, cls = "room-name") =>
  `<text x="${x}" y="${y}" class="${cls}" text-anchor="middle">${content}</text>`;
const rect = (x: number, z: number, w: number, d: number, attrs = "") =>
  `<rect x="${x}" y="${z}" width="${w}" height="${d}" ${attrs}/>`;
function partition(p: Wall) {
  const angle = (Math.atan2(p.b[1] - p.a[1], p.b[0] - p.a[0]) * 180) / Math.PI,
    len = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]);
  return `<g transform="translate(${p.a[0]} ${p.a[1]}) rotate(${angle})"><path d="M0 0 H${len}" class="partition"/>${p.door ? `<path d="M${p.door.offset} 0 h${p.door.width}" class="door-gap"/><path d="M${p.door.offset} 0 v${p.door.width} A${p.door.width} ${p.door.width} 0 0 0 ${p.door.offset + p.door.width} 0" class="door-swing"/>` : ""}</g>`;
}
function cornerColumn(x: number, z: number, outward: number, outwardZ = -1) {
  const project = frontElevation.cornerProject, leg = frontElevation.cornerLeg;
  const style = 'fill="#d7d0c2" stroke="#8a8c83" stroke-width=".03"';
  const x0 = Math.min(x + outward * project, x - outward * leg);
  const faceZ = Math.min(z, z + outwardZ * project);
  const sideZ = outwardZ < 0 ? z : z - leg;
  return rect(x0, faceZ, leg + project, project, style) + rect(Math.min(x, x + outward * project), sideZ, project, leg, style);
}
function facade(p: Facade) {
  const angle = (Math.atan2(p.b[1] - p.a[1], p.b[0] - p.a[0]) * 180) / Math.PI,
    len = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]);
  return `<g transform="translate(${p.a[0]} ${p.a[1]}) rotate(${angle})"><path d="M0 0 H${len}" class="outside-wall"/>${p.openings.map((o) => `<path d="M${o.at - o.w / 2} 0 h${o.w}" class="door-gap"/>${o.open ? "" : `<path d="M${o.at - o.w / 2} -.07 h${o.w} M${o.at - o.w / 2} .07 h${o.w}" class="window ${o.door ? "entry-door" : ""}"/>`}`).join("")}</g>`;
}
function furniture(f: Furniture) {
  const r =
    f.kind === "roundTable"
      ? `<circle cx="0" cy="0" r="${f.w / 2}" class="furniture table"/><circle r=".58" class="furniture"/>`
      : `${rect(-f.w / 2, -f.d / 2, f.w, f.d, `rx=".06" class="furniture ${f.kind}"`)}${f.kind === "bed" ? rect(-f.w / 2 + 0.08, f.d / 2 - 0.5, f.w - 0.16, 0.34, 'rx=".07" class="pillow"') : ""}`;
  return `<g transform="translate(${f.x} ${f.z}) rotate(${(-(f.rotation ?? 0) * 180) / Math.PI})">${r}</g>${f.label ? text(f.x, f.z + 0.06, f.label, "furniture-label") : ""}`;
}
function room(r: Room) {
  return `<g tabindex="0" role="button" data-room="${r.id}" aria-label="${r.name}，${r.note ?? "点击查看空间说明"}">${rect(r.x + 0.08, r.z + 0.08, r.w - 0.16, r.d - 0.16, `fill="${colors[r.kind]}" class="room-fill"`)}</g>`;
}
export function floorPlan(index: number, clearance: boolean, balcony: boolean) {
  const f = floors[index],
    allRooms = [...f.rooms, ...(index === 0 ? annexRooms : [])];
  const porch = site.portico, porchFront = site.main.z - porch.projection;
  const elevation = frontElevation;
  const [westPost, middleWest, middleEast, eastPost] = elevation.balustradePosts;
  const wallFace = floors[2].front;
  const sideFront = elevation.terraceFront;
  const terraceRails = `<path d="M${westPost.x} ${wallFace} V${sideFront} H${middleWest.x} M${eastPost.x} ${wallFace} V${sideFront} H${middleEast.x} M${middleWest.x} ${elevation.postZ} V${middleWest.z} H${middleEast.x} V${elevation.postZ}" class="balustrade"/>`;
  const s = `<defs><pattern id="void" patternUnits="userSpaceOnUse" width=".28" height=".28" patternTransform="rotate(45)"><rect width=".28" height=".28" fill="#f4f3ee"/><path d="M0 0 V.28" stroke="#d8d6cc" stroke-width=".045"/></pattern></defs>`;
  const labels = allRooms
    .map((r) => {
      const [x, z] = r.label ?? [r.x + r.w / 2, r.z + r.d / 2];
      return `<g class="room-label" pointer-events="none">${text(x, z - 0.05, r.name)}${text(x, z + 0.37, r.kind === "void" ? "两层通高 · 无楼板" : `${r.w.toFixed(1)} × ${r.d.toFixed(1)} m`, "room-size")}</g>`;
    })
    .join("");
  const stepLines = Array.from({ length: 9 }, (_, i) => {
    const sx = stairLayout.x, sz = stairLayout.z, flight = stairLayout.flight, gap = stairLayout.gap;
    return `<path d="M${sx} ${sz + i * 0.25} h${flight} M${sx + flight + gap} ${sz + (8 - i) * 0.25} h${flight}" class="step-line"/>`;
  }).join("");
  const columnNorth = elevation.porticoColumnZ - elevation.porticoColumnDepth / 2;
  const landingFront = columnNorth - 0.15;
  const tread = 0.3;
  const stepFront = landingFront - tread * 2;
  const westOuter = middleWest.x - middleWest.w / 2;
  const westInner = middleWest.x + middleWest.w / 2;
  const eastInner = middleEast.x - middleEast.w / 2;
  const eastOuter = middleEast.x + middleEast.w / 2;
  const rampRun = 2;
  const eastEnd = eastOuter + rampRun;
  const westEnd = westOuter - rampRun;
  const stone = `fill="#3a2422" stroke="#241614" stroke-width=".02"`;
  const grooves = (x0: number, x1: number) => {
    const dir = Math.sign(x1 - x0);
    let marks = "";
    for (let traveled = 0.28; traveled < rampRun - 0.18; traveled += 0.3)
      marks += `<path d="M${x0 + dir * traveled} ${columnNorth - 0.08} V${site.main.z + 0.08}" stroke="#5a4038" stroke-width=".016"/>`;
    return marks;
  };
  const approach = index === 0
    ? `<rect x="${westInner}" y="${stepFront}" width="${eastInner - westInner}" height="${landingFront - stepFront}" fill="#3a2422"/>
      <rect x="${westOuter}" y="${stepFront}" width="${westInner - westOuter}" height="${landingFront - stepFront}" fill="#3a2422"/>
      <rect x="${eastInner}" y="${stepFront}" width="${eastOuter - eastInner}" height="${landingFront - stepFront}" fill="#3a2422"/>
      <path d="M${westInner} ${landingFront - tread} H${eastInner} M${westInner} ${stepFront} H${eastInner}" class="step-line"/>
      <path d="M${eastOuter} ${columnNorth} H${eastEnd} V${site.main.z} H${eastOuter} Z" ${stone}/>
      <path d="M${westEnd} ${columnNorth} H${westOuter} V${site.main.z} H${westEnd} Z" ${stone}/>
      ${grooves(eastOuter, eastEnd)}${grooves(westOuter, westEnd)}
      ${text((westInner + eastInner) / 2, stepFront - 0.28, "柱间三步", "room-size")}
      ${text((eastOuter + eastEnd) / 2, columnNorth - 0.32, "朝东", "room-size")}
      ${text((westOuter + westEnd) / 2, columnNorth - 0.32, "朝西", "room-size")}`
    : "";
  const laneLabelX = (site.annex.x + site.annex.w + site.main.x) / 2;
  const laneLabelZ = circulation.sideDoorZ - circulation.sideDoorWidth / 2 - 1.9;
  return `<svg class="floor-svg ${index > 0 ? "main-floor-svg" : ""}" xmlns="http://www.w3.org/2000/svg" viewBox="${index === 0 ? "-1 -4.6 24 17.1" : "5.5 -4.6 17 17.1"}" aria-label="${f.name}户型平面图，北向上，东向右">
    ${s}<rect x="-.5" y="-4.4" width="23" height="16.5" rx=".2" fill="#fbfaf6"/>
    ${index === 0 ? `<path d="M0 -3.6 H21 M0 -3.9 V-3.3 M21 -3.9 V-3.3" class="dim-line"/>${text(10.5, -4.15, "东西总宽 21 m", "dim-label")}${text(18.6, -4.15, `层高 ${f.height.toFixed(1)} m`, "dim-label")}` : `<path d="M6.8 -3.6 H20.3 M6.8 -3.9 V-3.3 M20.3 -3.9 V-3.3" class="dim-line"/>${text(13.55, -4.15, "主楼面宽 13.5 m", "dim-label")}${text(8.4, -4.15, `层高 ${f.height.toFixed(1)} m`, "dim-label")}`}
    <path d="M21.35 ${f.front} V9 M21.05 ${f.front} h.5 M21.05 9 h.5" class="dim-line"/><text class="dim-label" x="21.6" y="4.4" transform="rotate(90 21.6 4.4)">${index === 2 ? "主体进深 8.2 m" : "进深 10.0 m"}</text>

    ${index === 0 ? `<path d="M.8 -3.15 H5.3 M.8 -3.28 v.26 M5.3 -3.28 v.26" class="dim-line"/>${text(3.05, -2.72, "辅楼 4.5×10 m", "dim-label")}<text x="0.42" y="5.2" class="dim-label" text-anchor="middle" transform="rotate(-90 0.42 5.2)">西侧 0.8 m</text>` : ""}
    <text x="20.65" y="5.2" class="dim-label" text-anchor="middle" transform="rotate(90 20.65 5.2)">东侧 0.7 m</text>
    ${index === 2 ? `${elevation.sideTerraces.map(t => rect(t.x, elevation.terraceFront, t.w, elevation.terraceBack - elevation.terraceFront, 'fill="#e9e2d4" stroke="#b4b6a9" stroke-width=".06"')).join("")}${text(8.85, -0.2, "西侧露台", "dim-label")}${text(18.4, -0.2, "东侧露台", "dim-label")}` : ""}
    ${rect(porch.x, index === 2 ? elevation.centerFront : porchFront, porch.w, index === 2 ? elevation.terraceBack - elevation.centerFront : porch.projection, `fill="${index === 1 ? "url(#void)" : "#e9e2d4"}" stroke="#b4b6a9" stroke-width=".06"`)}
    ${text(13.7, -1.95, index === 2 ? "中央露台 · 前方敞开" : index === 1 ? "门厅上空 · 无楼板" : "门厅 4.8×2 m · 另计", "dim-label")}
    ${approach}
    ${index < 2 ? `${elevation.balustradePosts.slice(1, 3).map(p => rect(p.x - p.w / 2, elevation.porticoColumnZ - elevation.porticoColumnDepth / 2, p.w, elevation.porticoColumnDepth, 'fill="#879183"')).join("")}${cornerColumn(elevation.cornerWestX, f.front - 0.12, -1)}${cornerColumn(elevation.cornerEastX, f.front - 0.12, 1)}` : `${terraceRails}${elevation.balustradePosts.map(p => rect(p.x - elevation.shortPostWidth / 2, p.z - elevation.shortPostWidth / 2, elevation.shortPostWidth, elevation.shortPostWidth, 'fill="#c3bba9" stroke="#777872" stroke-width=".04"')).join("")}${elevation.postXs.map(x => rect(x - elevation.dividerWidth / 2, elevation.postZ - .25, elevation.dividerWidth, .5, 'fill="#879183"')).join("")}${cornerColumn(elevation.cornerWestX, f.front - 0.12, -1)}${cornerColumn(elevation.cornerEastX, f.front - 0.12, 1)}${text(13.7, -0.48, "内退柱墙隔开两侧 · 短柱在50cm挡墙上", "room-size")}`}${cornerColumn(site.main.x, site.main.z + site.main.d, -1, 1)}${cornerColumn(site.main.x + site.main.w, site.main.z + site.main.d, 1, 1)}
    ${index === 0 ? rect(.18, -3.1, 5.12, 2.1, 'fill="none" stroke="#a9b9a1" stroke-width=".04" stroke-dasharray=".14 .12"') + text(3, -2.05, "约2m通道 · 接辅楼外侧梯田", "room-size") : ""}
    ${allRooms.map(room).join("")}
    ${[...f.furniture, ...(index === 0 ? annexFurniture : [])].map(furniture).join("")}
    ${stepLines}
    ${f.partitions.map(partition).join("")}${facades(index).map(facade).join("")}
    ${index === 0 ? annexPartitions.map(partition).join("") + facades(3).map(facade).join("") : ""}
    ${index === 1 ? `<path d="M${circulation.livingVoid.x + circulation.livingVoid.w} ${circulation.livingVoid.z + 0.16} V${circulation.livingVoid.z + circulation.livingVoid.d} H${circulation.livingVoid.x + 0.16}" class="balustrade"/>` : ""}
    ${index === 0 ? `<path d="M${site.annex.x + site.annex.w} ${circulation.sideDoorZ - circulation.sideDoorWidth / 2} H${site.main.x} M${site.annex.x + site.annex.w} ${circulation.sideDoorZ + circulation.sideDoorWidth / 2} H${site.main.x}" class="dim-line"/>${text(laneLabelX, circulation.sideDoorZ, "通辅楼", "room-size")}` : ""}
    ${index === 0 && clearance ? '<circle cx="2.9" cy="1.12" r="1.85" class="clearance"/><rect x="1.09" y="2.89" width="3.72" height="2.42" class="clearance"/>' : ""}
    ${balcony && index === 2 ? rect(12.65, 9, 2.5, 1.2, 'class="clearance"') + text(13.9, 9.7, "局部浅阳台", "room-size") : ""}
    ${labels}${index === 0 ? `<text x="${laneLabelX}" y="${laneLabelZ}" class="dim-label" text-anchor="middle" transform="rotate(-90 ${laneLabelX} ${laneLabelZ})">子孙道 · ${site.lane.toFixed(1)} m</text>` : ""}
    ${text(13.55, 10.55, "南侧高田 +2.5 m · 屋后留 1.8 m", "dim-label")}
    <g transform="translate(${index === 0 ? ".5" : "6.5"} 10.6)"><path d="M0 .8 V-.55 m-.15 .25 .15-.25 .15 .25" class="dim-line"/>${text(0, -0.85, "北 N", "dim-label")}<path d="M.45 .8 H2.6 m0-.12 v.24" class="dim-line"/>${text(2.6, 1.4, "东 E", "room-size")}</g>
    ${text(13.1, 11.45, "房间数字为外轮廓尺寸 · 使用面积另扣墙体 · 北向上", "footnote")}
    ${index === 0 ? text(10.5, 11.85, "地库柱：外沿一排、房前墙下一排，柱距4.2m，见地库视图", "footnote") : ""}
  </svg>`;
}

export function diningClearance() {
  const wallX = site.annex.x + 0.24,
    wallZ = site.annex.z + 0.24;
  const radius = 1.85;
  return {
    west: 2.9 - radius - wallX,
    north: 1.12 - radius - wallZ,
    east: site.annex.x + site.annex.w - 0.24 - 2.9 - radius,
  };
}
