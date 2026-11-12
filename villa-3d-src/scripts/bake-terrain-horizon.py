#!/usr/bin/env python3
"""烘焙 AWS Terrarium 原始地形，需要 Python 3 + Pillow。
不填谷、抬山、限高或平滑。瓦片缓存放系统临时目录，来源与校验值随数据保存。
TypeScript 入口再用页面相同的三角网采样器生成天际线。
"""
from __future__ import annotations

import datetime
import hashlib
import io
import json
import math
import sys
import tempfile
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

AMAP_GCJ_LAT, AMAP_GCJ_LON = 28.150050, 111.161875
ZOOM, RADIUS_M, NEAR_SKIP_M, BIN_DEG = 12, 20000, 0, 0.5
INNER_EXTENT_M, INNER_STEP_M, OUTER_STEP_M = 3200, 40, 120
FINE_EXTENT_M, FINE_STEP_M = 960, 10
CACHE = Path(tempfile.gettempdir()) / "anhua-dem-tiles-v3" / str(ZOOM)


def wgs_to_gcj(lat: float, lon: float) -> tuple[float, float]:
    """通用 GCJ 偏移近似公式，逆变换通过迭代消除单次相减的残差。"""
    a, ee = 6378245.0, 0.00669342162296594323
    x, y = lon - 105.0, lat - 35.0
    dlat = -100 + 2*x + 3*y + 0.2*y*y + 0.1*x*y + 0.2*math.sqrt(abs(x))
    dlon = 300 + x + 2*y + 0.1*x*x + 0.1*x*y + 0.1*math.sqrt(abs(x))
    common = (20*math.sin(6*x*math.pi) + 20*math.sin(2*x*math.pi))*2/3
    dlat += common + (20*math.sin(y*math.pi) + 40*math.sin(y/3*math.pi))*2/3
    dlat += (160*math.sin(y/12*math.pi) + 320*math.sin(y*math.pi/30))*2/3
    dlon += common + (20*math.sin(x*math.pi) + 40*math.sin(x/3*math.pi))*2/3
    dlon += (150*math.sin(x/12*math.pi) + 300*math.sin(x/30*math.pi))*2/3
    rad = math.radians(lat)
    magic = 1 - ee*math.sin(rad)**2
    return (lat + math.degrees(dlat / ((a*(1-ee)) / magic**1.5)),
            lon + math.degrees(dlon / (a / math.sqrt(magic)*math.cos(rad))))


def gcj_to_wgs(lat: float, lon: float) -> tuple[float, float]:
    wlat, wlon = lat, lon
    for _ in range(10):
        glat, glon = wgs_to_gcj(wlat, wlon)
        dlat, dlon = glat-lat, glon-lon
        wlat, wlon = wlat-dlat, wlon-dlon
        if max(abs(dlat), abs(dlon)) < 1e-10:
            break
    return wlat, wlon


LAT0, LON0 = gcj_to_wgs(AMAP_GCJ_LAT, AMAP_GCJ_LON)
A, B = 6378137.0, 6356752.314245
PHI, LAMBDA = math.radians(LAT0), math.radians(LON0)
UP = (math.cos(PHI)*math.cos(LAMBDA), math.cos(PHI)*math.sin(LAMBDA), math.sin(PHI))
EAST = (-math.sin(LAMBDA), math.cos(LAMBDA), 0.0)
NORTH = (-math.sin(PHI)*math.cos(LAMBDA), -math.sin(PHI)*math.sin(LAMBDA), math.cos(PHI))
N0 = A / math.sqrt(1-(1-B*B/(A*A))*math.sin(PHI)**2)
ORIGIN = (N0*UP[0], N0*UP[1], B*B/(A*A)*N0*UP[2])
METRIC = (1/(A*A), 1/(A*A), 1/(B*B))


def local_to_wgs(east: float, north: float) -> tuple[float, float, float]:
    """WGS84 椭球反解局部东／北坐标，返回地球曲率向下修正。"""
    p = [ORIGIN[i]+east*EAST[i]+north*NORTH[i] for i in range(3)]
    qa = sum(UP[i]*UP[i]*METRIC[i] for i in range(3))
    qb = 2*sum(p[i]*UP[i]*METRIC[i] for i in range(3))
    qc = sum(p[i]*p[i]*METRIC[i] for i in range(3))-1
    drop = -2*qc/(qb+math.sqrt(qb*qb-4*qa*qc))
    p = [p[i]+drop*UP[i] for i in range(3)]
    return (math.degrees(math.atan2(p[2]/(B*B), math.hypot(p[0], p[1])/(A*A))),
            math.degrees(math.atan2(p[1], p[0])), drop)


def latlon_to_pixel(lat: float, lon: float) -> tuple[float, float]:
    size = 256*2**ZOOM
    return ((lon+180)/360*size,
            (1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*size)


def decode(rgb: tuple[int, int, int]) -> float:
    r, g, b = rgb
    return r*256+g+b/256-32768


def download_tile(key: tuple[int, int]):
    tx, ty = key
    url = f"https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{ZOOM}/{tx}/{ty}.png"
    path = CACHE/f"{tx}-{ty}.png"
    meta_path = path.with_suffix(".json")
    if path.exists() and meta_path.exists():
        content, meta = path.read_bytes(), json.loads(meta_path.read_text())
    else:
        for attempt in range(3):
            try:
                with urllib.request.urlopen(url, timeout=45) as response:
                    content = response.read()
                    meta = {
                        "url": url,
                        "imagerySources": response.headers.get("x-amz-meta-x-imagery-sources", ""),
                        "etag": response.headers.get("ETag", ""),
                        "lastModified": response.headers.get("Last-Modified", ""),
                        "sha256": hashlib.sha256(content).hexdigest(),
                    }
                image = Image.open(io.BytesIO(content)).convert("RGB")
                if image.size != (256, 256):
                    raise ValueError(f"Unexpected tile size: {image.size}")
                path.write_bytes(content)
                meta_path.write_text(json.dumps(meta), encoding="utf-8")
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(attempt+1)
    if hashlib.sha256(content).hexdigest() != meta["sha256"]:
        raise ValueError(f"缓存校验失败，请删除后重试: {path}")
    return key, Image.open(io.BytesIO(content)).convert("RGB"), meta


def main() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    samples = [latlon_to_pixel(*local_to_wgs(e, n)[:2])
               for e in (-RADIUS_M, 0, RADIUS_M) for n in (-RADIUS_M, 0, RADIUS_M)]
    # 边中点覆盖曲率极值，并为像元中心的双线性插值保留相邻像元。
    xmin, xmax = math.floor((min(p[0] for p in samples)-0.5)/256), math.floor((max(p[0] for p in samples)+0.5)/256)
    ymin, ymax = math.floor((min(p[1] for p in samples)-0.5)/256), math.floor((max(p[1] for p in samples)+0.5)/256)
    keys = [(x, y) for x in range(xmin, xmax+1) for y in range(ymin, ymax+1)]
    with ThreadPoolExecutor(max_workers=6) as pool:
        fetched = list(pool.map(download_tile, keys))
    tiles = {key: image for key, image, _ in fetched}
    print(f"读取 {len(tiles)} 张 Terrarium 瓦片", flush=True)

    def pixel_height(x: int, y: int) -> float:
        height = decode(tiles[(x//256, y//256)].getpixel((x % 256, y % 256)))
        if height <= -32000:
            raise ValueError(f"DEM 无有效高程: pixel {x},{y}")
        return height

    def elevation(lat: float, lon: float) -> float:
        # 像元中心与跨瓦片双线性插值，避免向西北错半个像元。
        px, py = latlon_to_pixel(lat, lon)
        px, py = px-0.5, py-0.5
        x, y = math.floor(px), math.floor(py)
        u, v = px-x, py-y
        h0 = pixel_height(x, y)*(1-u)+pixel_height(x+1, y)*u
        h1 = pixel_height(x, y+1)*(1-u)+pixel_height(x+1, y+1)*u
        return h0*(1-v)+h1*v

    site_h = elevation(LAT0, LON0)
    axes = list(range(-RADIUS_M, -INNER_EXTENT_M, OUTER_STEP_M))
    axes += list(range(-INNER_EXTENT_M, -FINE_EXTENT_M, INNER_STEP_M))
    axes += list(range(-FINE_EXTENT_M, FINE_EXTENT_M+1, FINE_STEP_M))
    axes += list(range(FINE_EXTENT_M+INNER_STEP_M, INNER_EXTENT_M+1, INNER_STEP_M))
    axes += list(range(INNER_EXTENT_M+OUTER_STEP_M, RADIUS_M+1, OUTER_STEP_M))
    relative = []
    for north in axes:
        for east in axes:
            lat, lon, curvature = local_to_wgs(east, north)
            relative.append(round(elevation(lat, lon)-site_h+curvature, 3))
    payload = {
        "version": 3,
        "latitude": round(LAT0, 10), "longitude": round(LON0, 10),
        "amapGcj02": {"longitude": AMAP_GCJ_LON, "latitude": AMAP_GCJ_LAT},
        "siteElevM": round(site_h, 3), "zoom": ZOOM, "radiusM": RADIUS_M,
        "nearSkipM": NEAR_SKIP_M, "binDeg": BIN_DEG,
        "elevationDeg": [], "peakDistanceM": [], "peakElevM": [],
        "source": "AWS Mapzen Terrain Tiles / SRTM N28E111 (native ~30 m)",
        "attribution": "Mapzen; SRTM data courtesy of the U.S. Geological Survey",
        "registry": "https://registry.opendata.aws/terrain-tiles/",
        "note": "原始DEM双线性重采样与WGS84椭球曲率修正，无填谷、抬山、限高、平滑。院坪海拔与坐标锚点待实测。",
        "verticalDatum": "EGM96 orthometric height (SRTM), meters",
        "reference": {
            "modelAnchorMm": {"x": 10500, "z": 4600},
            "anchorDescription": "沿用高德旧房中心近似定位，模型锚点待测",
            "courtyardElevationM": round(site_h, 3), "elevationMeasured": False,
            "modelNorthAzimuthDeg": 0, "orientationMeasured": False,
            "orientationEvidence": {
                "photo": "dji_fly_20260816_135022_748_1786859598655_photo.jpg",
                "cameraLatitude": 28.1535778, "cameraLongitude": 111.1564162,
                "gimbalYawDeg": 175.8, "gimbalPitchDeg": -6.3,
                "note": "用户指定北侧正面照片；相机朝向支持近似朝北，建筑轴线角度与院坪高程待标定",
            },
        },
        "tiles": [meta for _, _, meta in fetched],
        "bakedAt": datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat(timespec="seconds"),
        "grid": {
            "extentM": RADIUS_M, "stepM": FINE_STEP_M, "coordinatesM": axes,
            "cols": len(axes), "rows": len(axes), "holeRadiusM": NEAR_SKIP_M,
            "relativeHeightM": relative, "heightMode": "raw-dem-local-tangent",
            "axis": "east-north-from-fixed-site-anchor",
        },
    }
    result = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    # 先写临时原始网格，由 TypeScript 完成天际线计算后统一发布。
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else CACHE/"grid.json"
    target.write_text(result, encoding="utf-8")
    print(f"WGS84 {LAT0:.10f}, {LON0:.10f}; DEM基准 {site_h:.3f} m; {len(axes)}×{len(axes)}", flush=True)


if __name__ == "__main__":
    main()
