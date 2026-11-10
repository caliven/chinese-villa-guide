import * as THREE from "three";
import { escapeHtml } from "./project-meta.ts";

type Point2 = [number, number];
type Segment = [Point2, Point2];
export interface SectionContour {
  name: string;
  category: string;
  paths: Point2[][];
}
export interface SectionCut {
  axis: "x" | "z";
  at: number;
  category: (mesh: THREE.Mesh) => string | undefined;
}

const snap = (value: number) => Math.round(value * 100) / 100;
const key = (p: Point2) => `${snap(p[0])},${snap(p[1])}`;

/** 三角面与真实剖切平面求交，保留墙洞、楼板洞及退台，禁止用包围盒替代实体。 */
export function modelSection(root: THREE.Object3D, cut: SectionCut): SectionContour[] {
  root.updateWorldMatrix(true, true);
  const contours: SectionContour[] = [];
  const plane = new THREE.Plane(cut.axis === "x" ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1), -cut.at);
  root.traverseVisible(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const category = cut.category(object);
    if (!category) return;
    const matrices: THREE.Matrix4[] = [];
    if (object instanceof THREE.InstancedMesh) {
      for (let instance = 0; instance < object.count; instance++) {
        const matrix = new THREE.Matrix4();
        object.getMatrixAt(instance, matrix);
        matrices.push(matrix.premultiply(object.matrixWorld));
      }
    } else matrices.push(object.matrixWorld);
    const paths = matrices.flatMap(matrix => intersectGeometry(object.geometry, matrix, plane, cut.axis));
    if (paths.length) contours.push({ name: object.name, category, paths });
  });
  return contours;
}

function intersectGeometry(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, plane: THREE.Plane, axis: "x" | "z"): Point2[][] {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!.clone().applyMatrix4(matrix);
  if (!plane.intersectsBox(bounds)) return [];
  const positions = geometry.getAttribute("position"), index = geometry.index;
  const segments: Segment[] = [];
  const points = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const count = index?.count ?? positions.count;
  for (let offset = 0; offset < count; offset += 3) {
    for (let vertex = 0; vertex < 3; vertex++) {
      points[vertex].fromBufferAttribute(positions, index ? index.getX(offset + vertex) : offset + vertex).applyMatrix4(matrix);
    }
    const distances = points.map(point => plane.distanceToPoint(point));
    if (distances.every(distance => Math.abs(distance) < .0001)) continue;
    const intersections = new Map<string, Point2>();
    for (let edge = 0; edge < 3; edge++) {
      const next = (edge + 1) % 3, da = distances[edge], db = distances[next];
      if (da * db > 0 || Math.abs(da - db) < .0001) continue;
      const point = points[edge].clone().lerp(points[next], da / (da - db));
      const flat: Point2 = [snap(axis === "x" ? point.z : point.x), snap(-point.y)];
      intersections.set(key(flat), flat);
    }
    if (intersections.size === 2) segments.push([...intersections.values()] as Segment);
  }
  return joinSegments(segments);
}

function joinSegments(segments: Segment[]): Point2[][] {
  const edges = new Map<string, Segment>();
  const links = new Map<string, Set<string>>();
  for (const segment of segments) {
    const ends = segment.map(key), id = ends.slice().sort().join("|");
    if (ends[0] === ends[1] || edges.has(id)) continue;
    edges.set(id, segment);
    for (const end of ends) {
      if (!links.has(end)) links.set(end, new Set());
      links.get(end)!.add(id);
    }
  }
  const paths: Point2[][] = [];
  while (edges.size) {
    const [id, segment] = edges.entries().next().value!;
    edges.delete(id);
    const points = [...segment];
    let end = key(points.at(-1)!);
    while (end !== key(points[0])) {
      const nextId = [...(links.get(end) ?? [])].find(candidate => edges.has(candidate));
      if (!nextId) break;
      const next = edges.get(nextId)!;
      edges.delete(nextId);
      const point = key(next[0]) === end ? next[1] : next[0];
      points.push(point);
      end = key(point);
    }
    paths.push(points);
  }
  return paths;
}

export interface SectionSvgOptions {
  id: string;
  title: string;
  range: [number, number];
  levels: { y: number; label: string }[];
  depth: number;
  dimensionStart?: number;
  annotations?: { x: number; y: number; label: string }[];
}

/** 输出等比例矢量剖面，标高、剖切构件与模型保持同源。 */
export function sectionSvg(contours: SectionContour[], options: SectionSvgOptions): string {
  const [left, right] = options.range;
  const dimensionStart = options.dimensionStart ?? left;
  const paths = contours.map(contour => {
    const d = contour.paths.map(points => `M${points.map(point => point.join(" ")).join(" L")}${key(points[0]) === key(points.at(-1)!) ? " Z" : ""}`).join(" ");
    return `<path d="${d}" class="section-${contour.category}" fill-rule="evenodd" data-component="${escapeHtml(contour.name)}"/>`;
  }).join("");
  const levels = options.levels.map(level => `<path d="M${left - 250} ${-level.y} H${right + 300}" class="section-guide"/><text x="${right + 400}" y="${-level.y + 70}">${escapeHtml(level.label)}</text>`).join("");
  const annotations = (options.annotations ?? []).map(note => `<text x="${note.x}" y="${-note.y}" class="section-note">${escapeHtml(note.label)}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" class="section-svg" viewBox="${left - 800} -14000 ${right - left + 4400} 15500" aria-label="${escapeHtml(options.title)}" data-section="${options.id}"><style>
    .section-svg{font:220px "Hiragino Sans GB",sans-serif;background:white}.section-svg text{fill:#222}.section-svg path{stroke-linejoin:round;stroke-linecap:round}
    .section-solid{fill:#e3e3e3;stroke:#222;stroke-width:18}.section-timber{fill:#ded8cd;stroke:#555;stroke-width:12}.section-roof{fill:#dedede;stroke:#444;stroke-width:10}.section-stair{fill:#eee;stroke:#333;stroke-width:14}.section-guard{fill:#555;stroke:#555;stroke-width:8}.section-window{fill:#fff;stroke:#777;stroke-width:9}
    .section-guide{fill:none;stroke:#aaa;stroke-width:9;stroke-dasharray:100 70}.section-dimension{fill:none;stroke:#555;stroke-width:12}.section-note{font-size:200px}
    </style>${levels}${paths}<path d="M${left - 500} 0 H${right + 500}" class="section-dimension"/>
    <path d="M${dimensionStart} 750 V1050 M${dimensionStart} 900 H${dimensionStart + options.depth} M${dimensionStart + options.depth} 750 V1050" class="section-dimension"/><text x="${dimensionStart + options.depth / 2}" y="850" text-anchor="middle">主楼进深 ${options.depth}</text><text x="${left}" y="450">北 N</text><text x="${right}" y="450" text-anchor="end">南 S</text>${annotations}</svg>`;
}
