import * as THREE from "three";

export type HandrailSample = { point: THREE.Vector3; tangent: THREE.Vector3 };
export type HandrailSpan = { from: number; to: number };

/** 对整条扶手中心线作局部 C2 过渡，短平台与相邻坡度变化一起处理，不逐段扭斜端面。 */
export function smoothHandrailPath(points: THREE.Vector3[], spans: HandrailSpan[], width: number) {
  const stations = [0];
  const directions = points.slice(1).map((point, i) => {
    const delta = point.clone().sub(points[i]), length = delta.length();
    stations.push(stations.at(-1)! + length);
    return delta.divideScalar(length);
  });
  const total = stations.at(-1)!, closed = points[0].distanceTo(points.at(-1)!) < .1;
  const bends: { station: number; radius: number; delta: THREE.Vector3 }[] = [];
  for (let i = closed ? 0 : 1; i < points.length - 1; i++) {
    const delta = directions[i].clone().sub(directions[(i + directions.length - 1) % directions.length]);
    if (delta.lengthSq() < 1e-10) continue;
    const radius = Math.min(width * 1.7, closed ? total / 4 : Math.min(stations[i], total - stations[i]));
    if (radius > .1) bends.push({ station: stations[i], radius, delta });
  }
  if (closed) for (const bend of [...bends]) {
    if (bend.station - bend.radius < 0) bends.push({ ...bend, station: bend.station + total });
    if (bend.station + bend.radius > total) bends.push({ ...bend, station: bend.station - total });
  }
  const sample = (station: number): HandrailSample => {
    const s = closed && Math.abs(station - total) < .001 ? 0 : station;
    let i = 0;
    while (i < directions.length - 1 && stations[i + 1] <= s) i++;
    const point = points[i].clone().addScaledVector(directions[i], s - stations[i]);
    const tangent = directions[i].clone();
    for (const bend of bends) {
      const x = s - bend.station, r = bend.radius;
      if (Math.abs(x) >= r) continue;
      const t = (x + r) / (2 * r);
      // 光滑阶跃的积分替代折线的 max(0,x)，边界处一、二阶导数均连续。
      const hinge = 2 * r * (t ** 3 - t ** 4 / 2);
      point.addScaledVector(bend.delta, hinge - Math.max(0, x));
      tangent.addScaledVector(bend.delta, t * t * (3 - 2 * t) - (x >= 0 ? 1 : 0));
    }
    return { point, tangent: tangent.normalize() };
  };
  return spans.map(({ from, to }) => {
    const start = stations[from], end = stations[to];
    const cuts = [...new Set([start, end, ...bends.flatMap(b => [b.station - b.radius, b.station, b.station + b.radius])
      .filter(s => s > start + .001 && s < end - .001)])].sort((a, b) => a - b);
    const result: HandrailSample[] = [sample(start)];
    for (let i = 1; i < cuts.length; i++) {
      const a = cuts[i - 1], b = cuts[i], middle = (a + b) / 2;
      const curved = bends.some(bend => Math.abs(middle - bend.station) < bend.radius);
      const steps = curved ? Math.max(2, Math.ceil((b - a) / 10)) : 1;
      for (let j = 1; j <= steps; j++) result.push(sample(a + (b - a) * j / steps));
    }
    return result;
  });
}

/** 圆角矩形截面沿固定朝上的标架扫掠；接头共用位置、切线和法线，不使用扭曲的四边形。 */
export function handrailGeometry(path: HandrailSample[], width: number, height: number, radius: number, top = 0, capStart = true, capEnd = true) {
  const profile: { x: number; y: number; nx: number; ny: number }[] = [];
  const half = width / 2, r = Math.min(radius, half, height / 2);
  const corners = [[half - r, top - height + r, -90], [half - r, top - r, 0],
    [-half + r, top - r, 90], [-half + r, top - height + r, 180]];
  for (const [x, y, angle] of corners) for (let i = 0; i <= 5; i++) {
    const a = THREE.MathUtils.degToRad(angle + 90 * i / 5), nx = Math.cos(a), ny = Math.sin(a);
    profile.push({ x: x + nx * r, y: y + ny * r, nx, ny });
  }
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  const frames = path.map(({ point, tangent }) => {
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const up = side.clone().cross(tangent).normalize();
    return { point, tangent, side, up };
  });
  for (const { point, side, up } of frames) for (const p of profile) {
    positions.push(...point.clone().addScaledVector(side, p.x).addScaledVector(up, p.y).toArray());
    normals.push(...side.clone().multiplyScalar(p.nx).addScaledVector(up, p.ny).normalize().toArray());
    uvs.push(point.x / 700, (point.y + p.y + p.x) / 700);
  }
  const count = profile.length;
  for (let i = 0; i < path.length - 1; i++) for (let j = 0; j < count; j++) {
    const a = i * count + j, b = a + count, next = i * count + (j + 1) % count;
    indices.push(a, b, next, b, next + count, next);
  }
  const faces = THREE.ShapeUtils.triangulateShape(profile.map(p => new THREE.Vector2(p.x, p.y)), []);
  for (const [frame, enabled, start] of [[frames[0], capStart, true], [frames.at(-1)!, capEnd, false]] as const) {
    if (!enabled) continue;
    const offset = positions.length / 3;
    for (const p of profile) {
      positions.push(...frame.point.clone().addScaledVector(frame.side, p.x).addScaledVector(frame.up, p.y).toArray());
      normals.push(...frame.tangent.clone().multiplyScalar(start ? -1 : 1).toArray());
      uvs.push(p.x / 700, p.y / 700);
    }
    for (const [a, b, c] of faces) indices.push(offset + a, offset + (start ? b : c), offset + (start ? c : b));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.userData.handrailRings = path.length;
  geometry.userData.handrailRingSize = count;
  return geometry;
}
