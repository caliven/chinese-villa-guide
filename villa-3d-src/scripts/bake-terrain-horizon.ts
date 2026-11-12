/**
 * 重新烘焙安化远山天际线（Mapzen Terrarium / SRTM）。
 * 需要本机 Python 3 与 Pillow：`python3 -m pip install pillow`
 *
 *   cd villa-3d-src && npx tsx scripts/bake-terrain-horizon.ts
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "bake-terrain-horizon.py");
const temporary = mkdtempSync(path.join(tmpdir(), "anhua-dem-bake-"));
try {
  const rawPath = path.join(temporary, "raw.json");
  const result = spawnSync("python3", [script, rawPath], { stdio: "inherit" });
  if (result.status !== 0) throw new Error("DEM 下载或烘焙失败，已有地形保留");
  const { terrainHorizonProfile, horizonFromProfile } = await import("../src/terrain-elevation.ts");
  const { terrainAnalysisData, fitTerrainElevation } = await import("../src/surroundings.ts");
  const source = path.join(here, "../src/terrain-horizon-data.json");
  const data = terrainAnalysisData(fitTerrainElevation(JSON.parse(readFileSync(rawPath, "utf8"))));
  for (let azimuth = 0; azimuth < 360; azimuth += data.binDeg) {
    const observer = { eastM: 0, northM: 0, heightM: 0 };
    const horizon = horizonFromProfile(terrainHorizonProfile(azimuth, observer, data), 0);
    data.elevationDeg.push(Number(horizon.elevationDeg.toFixed(4)));
    data.peakDistanceM.push(Number(horizon.distanceM.toFixed(2)));
    data.peakElevM.push(Number((horizon.terrainM + data.siteElevM).toFixed(3)));
  }
  const text = JSON.stringify(data);
  const targets = [source, path.join(here, "../public/terrain/horizon.json")];
  for (const target of targets) writeFileSync(`${target}.tmp`, text);
  for (const target of targets) renameSync(`${target}.tmp`, target);
  console.log(`同源三角网天际线 ${data.elevationDeg.length} 方位，半径 ${data.radiusM} m`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
