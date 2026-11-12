/** DEM 事实源与同三角网天际线计算，坐标／高程均为米。 */
import horizonData from "./terrain-horizon-data.json" with { type: "json" };

export type TerrainBoundsMm = { left: number; right: number; front: number; back: number };

export type TerrainGrid = {
  extentM: number;
  stepM: number;
  coordinatesM?: number[];
  cols: number;
  rows: number;
  holeRadiusM: number;
  relativeHeightM: number[];
  heightMode?: string;
  axis?: string;
  courtyardBlendEndM?: number;
};

export type TerrainHorizonData = {
  version: number;
  latitude: number;
  longitude: number;
  amapGcj02?: { longitude: number; latitude: number };
  siteElevM: number;
  zoom: number;
  radiusM: number;
  nearSkipM: number;
  localModelBoundsMm?: TerrainBoundsMm;
  binDeg: number;
  elevationDeg: number[];
  peakDistanceM: number[];
  peakElevM: number[];
  source: string;
  attribution: string;
  registry: string;
  note: string;
  bakedAt: string;
  verticalDatum?: string;
  reference?: {
    modelAnchorMm: { x: number; z: number };
    anchorDescription: string;
    courtyardElevationM: number;
    elevationMeasured: boolean;
    elevationFit?: { method: string; offsetM: number; residualM: number[] };
    modelNorthAzimuthDeg: number;
    orientationMeasured: boolean;
    orientationEvidence?: {
      photo: string; cameraLatitude: number; cameraLongitude: number;
      gimbalYawDeg: number; gimbalPitchDeg: number; note: string;
    };
  };
  tiles?: { url: string; imagerySources: string; sha256: string; etag: string; lastModified: string }[];
  grid?: TerrainGrid;
  ring?: {
    innerM: number; outerM: number; azimuthCount: number; radialCount: number;
    relativeHeightM: number[]; heightMode?: string;
  };
};

export const defaultTerrainHorizon = horizonData as TerrainHorizonData;
export type TerrainObserver = { eastM: number; northM: number; heightM: number };
export type TerrainProfilePoint = { distanceM: number; heightM: number };

export function normalizeAzimuthDeg(azimuthDeg: number) {
  return ((azimuthDeg % 360) + 360) % 360;
}

const axesCache = new WeakMap<TerrainGrid, number[]>();
const maxHeightCache = new WeakMap<TerrainGrid, number>();
export function maximumTerrainHeightM(data = defaultTerrainHorizon) {
  if (!data.grid) return Infinity;
  let maximum = maxHeightCache.get(data.grid);
  if (maximum == null) {
    maximum = data.grid.relativeHeightM.reduce((max, height) => Math.max(max, height), -Infinity);
    maxHeightCache.set(data.grid, maximum);
  }
  return maximum - ((data.reference?.courtyardElevationM ?? data.siteElevM) - data.siteElevM);
}
export function terrainGridCoordinates(grid: TerrainGrid) {
  if (grid.coordinatesM) return grid.coordinatesM;
  let axes = axesCache.get(grid);
  if (!axes) {
    axes = Array.from({ length: grid.cols }, (_, i) => -grid.extentM + i * grid.stepM);
    axesCache.set(grid, axes);
  }
  return axes;
}

function cellAt(value: number, axes: number[]) {
  let low = 0, high = axes.length - 1;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (value < axes[middle]) high = middle;
    else low = middle;
  }
  return low;
}

/** 按渲染三角面插值，避免双线性曲面与可见三角网产生不同天际线。 */
export function terrainHeightM(eastM: number, northM: number, data = defaultTerrainHorizon) {
  const grid = data.grid;
  if (!grid) return null;
  const axes = terrainGridCoordinates(grid);
  const first = axes[0], last = axes.at(-1)!;
  if (eastM < first - 1e-7 || northM < first - 1e-7 || eastM > last + 1e-7 || northM > last + 1e-7) return null;
  eastM = Math.max(first, Math.min(last, eastM));
  northM = Math.max(first, Math.min(last, northM));
  const c = cellAt(eastM, axes), r = cellAt(northM, axes);
  const u = (eastM - axes[c]) / (axes[c + 1] - axes[c]);
  const v = (northM - axes[r]) / (axes[r + 1] - axes[r]);
  const i = r * grid.cols + c;
  const h00 = grid.relativeHeightM[i], h10 = grid.relativeHeightM[i + 1];
  const h01 = grid.relativeHeightM[i + grid.cols], h11 = grid.relativeHeightM[i + grid.cols + 1];
  const height = u >= v
    ? h00 + u * (h10 - h00) + v * (h11 - h10)
    : h00 + u * (h11 - h01) + v * (h01 - h00);
  return height - ((data.reference?.courtyardElevationM ?? data.siteElevM) - data.siteElevM);
}

/** 固定地理锚点，调整房宽／进深和主辅楼位置不会移动周围山体。 */
export function handmadeHouseCenterMm(data = defaultTerrainHorizon) {
  return data.reference?.modelAnchorMm ?? { x: 10500, z: 4600 };
}

export function modelPointToTerrain(xMm: number, yMm: number, zMm: number, data = defaultTerrainHorizon): TerrainObserver {
  const anchor = handmadeHouseCenterMm(data);
  const east = (xMm - anchor.x) / 1000, north = (anchor.z - zMm) / 1000;
  const angle = (data.reference?.modelNorthAzimuthDeg ?? 0) * Math.PI / 180;
  return {
    eastM: east * Math.cos(angle) + north * Math.sin(angle),
    northM: north * Math.cos(angle) - east * Math.sin(angle),
    heightM: yMm / 1000,
  };
}

export function terrainPointToModel(eastM: number, northM: number, heightM: number, data = defaultTerrainHorizon) {
  const anchor = handmadeHouseCenterMm(data);
  const angle = (data.reference?.modelNorthAzimuthDeg ?? 0) * Math.PI / 180;
  const east = eastM * Math.cos(angle) - northM * Math.sin(angle);
  const north = northM * Math.cos(angle) + eastM * Math.sin(angle);
  return { x: anchor.x + east * 1000, y: heightM * 1000, z: anchor.z - north * 1000 };
}

/**
 * 射线与每条网格边界及单元对角线的交点。
 * 三角面内高度与距离线性，仰角极值只可能出现在这些端点，避免固定步进漏掉山脊。
 */
export function terrainHorizonProfile(azimuthDeg: number, observer: TerrainObserver, data = defaultTerrainHorizon, maxDistanceM = Infinity): TerrainProfilePoint[] {
  if (!data.grid) return [];
  const axes = terrainGridCoordinates(data.grid);
  const azimuth = normalizeAzimuthDeg(azimuthDeg) * Math.PI / 180;
  const de = Math.sin(azimuth), dn = Math.cos(azimuth);
  const projection = observer.eastM * de + observer.northM * dn;
  const radius2 = observer.eastM ** 2 + observer.northM ** 2;
  const exit = -projection + Math.sqrt(Math.max(0, projection ** 2 + data.nearSkipM ** 2 - radius2));
  let start = radius2 < data.nearSkipM ** 2 ? Math.max(0.01, exit) : 0.01;
  const end = Math.min(maxDistanceM, -projection + Math.sqrt(Math.max(0, projection ** 2 + data.radiusM ** 2 - radius2)));
  // 院坪、邻房与DEM接缝由同一批可见近场三角面计算，原始DEM从其外沿继续。
  let localEnter = Infinity, localExit = -Infinity;
  if (data.localModelBoundsMm) {
    const origin = terrainPointToModel(observer.eastM, observer.northM, 0, data);
    const next = terrainPointToModel(observer.eastM + de, observer.northM + dn, 0, data);
    const bounds = data.localModelBoundsMm;
    localEnter = -Infinity;
    localExit = Infinity;
    for (const [position, direction, min, max] of [
      [origin.x, next.x - origin.x, bounds.left, bounds.right],
      [origin.z, next.z - origin.z, bounds.front, bounds.back],
    ]) {
      if (Math.abs(direction) < 1e-9) {
        if (position < min || position > max) { localEnter = Infinity; localExit = -Infinity; break; }
        continue;
      }
      const a = (min - position) / direction, b = (max - position) / direction;
      localEnter = Math.max(localEnter, Math.min(a, b));
      localExit = Math.min(localExit, Math.max(a, b));
    }
    if (localEnter <= start && localExit > start) start = localExit;
  }
  if (end <= start) return [];
  const crossings = [start, end];
  for (const distance of [localEnter, localExit]) {
    if (distance > start && distance < end) crossings.push(distance);
  }
  for (const coordinate of axes) {
    const eastDistance = (coordinate - observer.eastM) / de;
    const northDistance = (coordinate - observer.northM) / dn;
    if (Math.abs(de) > 1e-12 && eastDistance > start && eastDistance < end) crossings.push(eastDistance);
    if (Math.abs(dn) > 1e-12 && northDistance > start && northDistance < end) crossings.push(northDistance);
  }
  crossings.sort((a, b) => a - b);
  const distances = [...crossings];
  for (let i = 1; i < crossings.length; i++) {
    const left = crossings[i - 1], right = crossings[i];
    if (right - left < 1e-8) continue;
    const midpoint = (left + right) / 2;
    const c = cellAt(observer.eastM + de * midpoint, axes);
    const r = cellAt(observer.northM + dn * midpoint, axes);
    const dx = axes[c + 1] - axes[c], dy = axes[r + 1] - axes[r];
    const slope = de / dx - dn / dy;
    if (Math.abs(slope) < 1e-12) continue;
    const intercept = (observer.eastM - axes[c]) / dx - (observer.northM - axes[r]) / dy;
    const diagonal = -intercept / slope;
    if (diagonal > left && diagonal < right) distances.push(diagonal);
  }
  return distances.filter(distance => distance <= localEnter || distance >= localExit).map(distanceM => {
    const heightM = terrainHeightM(observer.eastM + de * distanceM, observer.northM + dn * distanceM, data);
    if (heightM == null || !Number.isFinite(heightM)) throw new Error("DEM 未覆盖日照射线，请重新烘焙地形");
    return { distanceM, heightM };
  });
}

export function horizonFromProfile(profile: TerrainProfilePoint[], heightM: number) {
  let slope = -Infinity, distanceM = 0, terrainM = 0;
  for (const point of profile) {
    const candidate = (point.heightM - heightM) / point.distanceM;
    if (candidate > slope) {
      slope = candidate;
      distanceM = point.distanceM;
      terrainM = point.heightM;
    }
  }
  return { elevationDeg: Math.atan(slope) * 180 / Math.PI, distanceM, terrainM };
}

export function horizonElevationDeg(azimuthDeg: number, data = defaultTerrainHorizon) {
  if (!data.elevationDeg.length) return 0;
  const stepped = normalizeAzimuthDeg(azimuthDeg) / data.binDeg;
  const i = Math.floor(stepped), fraction = stepped - i;
  return data.elevationDeg[i % data.elevationDeg.length] * (1 - fraction)
    + data.elevationDeg[(i + 1) % data.elevationDeg.length] * fraction;
}

export function horizonAtObserver(azimuthDeg: number, observer: TerrainObserver, data = defaultTerrainHorizon) {
  if (!data.grid) return horizonElevationDeg(azimuthDeg, data);
  return horizonFromProfile(terrainHorizonProfile(azimuthDeg, observer, data), observer.heightM).elevationDeg;
}

export function sunClearsHorizon(altitudeDeg: number, azimuthDeg: number, data = defaultTerrainHorizon) {
  return altitudeDeg > 0 && altitudeDeg > horizonElevationDeg(azimuthDeg, data);
}

/** 太阳圆盘约0.533°，由圆弓面积计算可见比例，遮全时直射归零。 */
export function sunHorizonLightFactor(altitudeDeg: number, azimuthDeg: number, data = defaultTerrainHorizon, ridge = horizonElevationDeg(azimuthDeg, data)) {
  if (altitudeDeg <= 0) return 0;
  const fraction = Math.max(-1, Math.min(1, (altitudeDeg - ridge) / (0.533 / 2)));
  return (Math.acos(-fraction) + fraction * Math.sqrt(1 - fraction * fraction)) / Math.PI;
}
