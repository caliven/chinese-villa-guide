import {
  floors,
  site,
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
function facade(p: Facade) {
  const angle = (Math.atan2(p.b[1] - p.a[1], p.b[0] - p.a[0]) * 180) / Math.PI,
    len = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]);
  return `<g transform="translate(${p.a[0]} ${p.a[1]}) rotate(${angle})"><path d="M0 0 H${len}" class="outside-wall"/>${p.openings.map((o) => `<path d="M${o.at - o.w / 2} 0 h${o.w}" class="door-gap"/><path d="M${o.at - o.w / 2} -.07 h${o.w} M${o.at - o.w / 2} .07 h${o.w}" class="window ${o.door ? "entry-door" : ""}"/>`).join("")}</g>`;
}
function furniture(f: Furniture) {
  const r =
    f.kind === "roundTable"
      ? `<circle cx="0" cy="0" r="${f.w / 2}" class="furniture table"/><circle r=".58" class="furniture"/>`
      : `${rect(-f.w / 2, -f.d / 2, f.w, f.d, `rx=".06" class="furniture ${f.kind}"`)}${f.kind === "bed" ? rect(-f.w / 2 + 0.08, f.d / 2 - 0.5, f.w - 0.16, 0.34, 'rx=".07" class="pillow"') : ""}`;
  return `<g transform="translate(${f.x} ${f.z}) rotate(${(-(f.rotation ?? 0) * 180) / Math.PI})">${r}</g>`;
}
function room(r: Room) {
  return `<g tabindex="0" role="button" data-room="${r.id}" aria-label="${r.name}，${r.note ?? "点击查看空间说明"}">${rect(r.x + 0.08, r.z + 0.08, r.w - 0.16, r.d - 0.16, `fill="${colors[r.kind]}" class="room-fill"`)}</g>`;
}
export function floorPlan(index: number, clearance: boolean, balcony: boolean) {
  const f = floors[index],
    allRooms = [...f.rooms, ...(index === 0 ? annexRooms : [])];
  const porch = site.portico, porchFront = site.main.z - porch.projection;
  const s = `<defs><pattern id="void" patternUnits="userSpaceOnUse" width=".28" height=".28" patternTransform="rotate(45)"><rect width=".28" height=".28" fill="#f4f3ee"/><path d="M0 0 V.28" stroke="#d8d6cc" stroke-width=".045"/></pattern></defs>`;
  const labels = allRooms
    .map((r) => {
      const [x, z] = r.label ?? [r.x + r.w / 2, r.z + r.d / 2];
      return `<g class="room-label" pointer-events="none">${text(x, z - 0.05, r.name)}${text(x, z + 0.37, r.kind === "void" ? "两层通高 · 无楼板" : `${r.w.toFixed(1)} × ${r.d.toFixed(1)} m`, "room-size")}</g>`;
    })
    .join("");
  const stepLines = Array.from(
    { length: 10 },
    (_, i) =>
      `<path d="M${17.02 + i * 0.25} 1.2 v1.1 M${17.02 + i * 0.25} 3.15 v1.1" class="step-line"/>`,
  ).join("");
  return `<svg class="floor-svg ${index > 0 ? "main-floor-svg" : ""}" xmlns="http://www.w3.org/2000/svg" viewBox="${index === 0 ? "-1 -4.6 24 17.1" : "5.5 -4.6 17 17.1"}" aria-label="${f.name}户型平面图，北向上，东向右">
    ${s}<rect x="-.5" y="-4.4" width="23" height="16.5" rx=".2" fill="#fbfaf6"/>
    ${index === 0 ? `<path d="M0 -3.6 H21.1 M0 -3.9 V-3.3 M21.1 -3.9 V-3.3" class="dim-line"/>${text(10.55, -4.15, "东西总宽 21.1 m", "dim-label")}${text(18.6, -4.15, `层高 ${f.height.toFixed(1)} m`, "dim-label")}` : `<path d="M6.8 -3.6 H20.3 M6.8 -3.9 V-3.3 M20.3 -3.9 V-3.3" class="dim-line"/>${text(13.55, -4.15, "主楼面宽 13.5 m", "dim-label")}${text(8.4, -4.15, `层高 ${f.height.toFixed(1)} m`, "dim-label")}`}
    <path d="M21.45 ${f.front} V9 M21.2 ${f.front} h.5 M21.2 9 h.5" class="dim-line"/><text class="dim-label" x="21.7" y="4.4" transform="rotate(90 21.7 4.4)">${index === 2 ? "主体进深 8.2 m" : "进深 10.0 m"}</text>
    ${index === 0 ? `<path d="M.8 -3.15 H5.3 M.8 -3.28 v.26 M5.3 -3.28 v.26" class="dim-line"/>${text(3.05, -2.72, "辅楼 4.5×10 m", "dim-label")}<text x="0.42" y="5.2" class="dim-label" text-anchor="middle" transform="rotate(-90 0.42 5.2)">西侧 0.8 m</text>` : ""}
    <text x="20.55" y="5.2" class="dim-label" text-anchor="middle" transform="rotate(90 20.55 5.2)">东侧 0.8 m</text>
    ${index === 2 ? rect(6.8, -1, 13.5, 1.8, 'fill="#e9e2d4" stroke="#b4b6a9" stroke-width=".06"') + text(13.55, -0.35, "北侧退台露台 · 1.8 m", "dim-label") : ""}
    ${rect(porch.x, porchFront, porch.w, porch.projection, `fill="${index === 1 ? "url(#void)" : "#e9e2d4"}" stroke="#b4b6a9" stroke-width=".06"`)}
    ${text(13.7, -1.95, index === 2 ? "门厅平台 · 外伸 2 m" : index === 1 ? "门厅上空 · 无楼板" : "门厅 4.8×2 m · 另计", "dim-label")}
    ${index < 2 ? [11.68, 15.72].map(x => rect(x - .29, porchFront + .11, .58, .56, 'fill="#879183"')).join("") : '<path d="M11.46 -.85 V-2.82 H15.94 V-.85" class="balustrade"/>'}
    ${index === 0 ? rect(.18, -3.1, 5.12, 2.1, 'fill="none" stroke="#a9b9a1" stroke-width=".04" stroke-dasharray=".14 .12"') + text(3, -2.05, "约2m通道 · 接辅楼外侧梯田", "room-size") : ""}
    ${allRooms.map(room).join("")}
    ${[...f.furniture, ...(index === 0 ? annexFurniture : [])].map(furniture).join("")}
    ${stepLines}<path d="M16.7 1.75 H19.75 V3.7 H16.7 m.25-.13 -.25 .13 .25 .13" class="door-swing"/>
    ${f.partitions.map(partition).join("")}${facades(index).map(facade).join("")}
    ${index === 0 ? annexPartitions.map(partition).join("") + facades(3).map(facade).join("") : ""}
    ${index === 1 ? '<path d="M11.47 3.04 V8.85" class="balustrade"/>' : ""}
    ${index === 0 && clearance ? '<circle cx="2.9" cy="1.12" r="1.85" class="clearance"/><rect x="1.09" y="2.89" width="3.72" height="2.42" class="clearance"/>' : ""}
    ${balcony && index === 2 ? rect(12.65, 9, 2.5, 1.2, 'class="clearance"') + text(13.9, 9.7, "局部浅阳台", "room-size") : ""}
    ${labels}${index === 0 ? '<text x="6.05" y="4.3" class="dim-label" text-anchor="middle" transform="rotate(-90 6.05 4.3)">子孙道 · 1.5 m</text>' : ""}
    ${text(13.55, 10.55, "南侧高田 +2.5 m · 屋后留 1.8 m", "dim-label")}
    <g transform="translate(${index === 0 ? ".5" : "6.5"} 10.6)"><path d="M0 .8 V-.55 m-.15 .25 .15-.25 .15 .25" class="dim-line"/>${text(0, -0.85, "北 N", "dim-label")}<path d="M.45 .8 H2.6 m0-.12 v.24" class="dim-line"/>${text(2.6, 1.4, "东 E", "room-size")}</g>
    ${text(13.1, 11.45, "房间数字为外轮廓尺寸 · 使用面积另扣墙体 · 北向上", "footnote")}
    ${index === 0 ? text(10.55, 11.85, "地库柱：外沿一排、房前墙下一排，柱距4.2m，见地库视图", "footnote") : ""}
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
