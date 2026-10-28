import * as THREE from "three";
import { canonicalRailingStyle, type RailingStyle } from "./railing-options";
import { railingModel } from "./railing-model";
import { smoothHandrailPath, type HandrailSample } from "./railing-handrail";

export type RailingSection = {
  a: THREE.Vector3; b: THREE.Vector3; style: RailingStyle; height: number;
  footing?: { t: number; y: number }[];
  startHeight?: number; endHeight?: number;
  connectionGroup?: string; postPriority?: number;
};
export type RailingEndJoint = {
  /** 世界坐标下的单位横截面偏移；相接两段共用此截面，避免直角盒子互相穿插。 */
  miter: THREE.Vector3; base: number; top: number; post: boolean; hasPost: boolean;
};
export type RailingJoints = { start?: RailingEndJoint; end?: RailingEndJoint };
type Port = { index: number; start: boolean; point: THREE.Vector3; top: number };

/** 先确定整条路径的节点，再渲染各段；节点可以由不同楼层／来梯可见性组持有。 */
export function railingNetwork(sections: RailingSection[]) {
  const nodes: Port[][] = [];
  const ports = sections.map((section, index) => ([true, false] as const).map(start => {
    const point = start ? section.a : section.b;
    const port = { index, start, point, top: point.y + ((start ? section.startHeight : section.endHeight) ?? section.height) };
    const node = nodes.find(list => {
      const other = sections[list[0].index];
      return canonicalRailingStyle(other.style) === canonicalRailingStyle(section.style)
        && other.connectionGroup === section.connectionGroup && list[0].point.distanceTo(point) < .1;
    });
    if (node) node.push(port); else nodes.push([port]);
    return port;
  }));
  // 高度不同的梯段／平台在共同节点取较高扶手标高，柱脚仍落在节点实际地面。
  for (const node of nodes) {
    const top = Math.max(...node.map(port => port.top));
    node.forEach(port => port.top = top);
  }
  const joints: RailingJoints[] = sections.map(() => ({}));
  for (const node of nodes) {
    if (node.length < 2) continue;
    const direction = (port: Port) => {
      const other = ports[port.index][port.start ? 1 : 0];
      const vector = other.point.clone().sub(port.point); vector.y = 0;
      return { vector: vector.normalize(), slope: (other.top - port.top) / Math.max(1, Math.hypot(other.point.x - port.point.x, other.point.z - port.point.z)) };
    };
    const first = direction(node[0]).vector, second = direction(node[1]).vector;
    const hasPost = node.length !== 2 || first.dot(second) > -.9999;
    const owner = node.reduce((best, port) => (sections[port.index].postPriority ?? 0) > (sections[best.index].postPriority ?? 0) ? port : best);
    for (const port of node) {
      const { vector: away, slope } = direction(port);
      const neighbor = direction(node.find(other => other !== port)!);
      const incoming = away.clone().negate(), outgoing = neighbor.vector;
      const left = (v: THREE.Vector3) => new THREE.Vector3(-v.z, 0, v.x);
      const denominator = 1 + incoming.dot(outgoing);
      const miter = denominator > .01 ? left(incoming).add(left(outgoing)).divideScalar(denominator) : left(incoming);
      if (port.start) miter.negate();
      // 共用斜接边的高度，斜段与水平段不再各自留下一个不同标高的端面。
      miter.y = (slope * miter.dot(away) + neighbor.slope * miter.dot(outgoing)) / 2;
      joints[port.index][port.start ? "start" : "end"] = {
        miter, base: port.point.y, top: port.top, post: hasPost && port === owner, hasPost,
      };
    }
  }
  const handrails: HandrailSample[][] = sections.map(() => []);
  const visited = new Set<number>();
  const trace = (first: Port) => {
    const chain: { index: number; reversed: boolean; from: number; to: number }[] = [];
    const points = [first.point.clone().setY(first.top)];
    let port = first;
    while (!visited.has(port.index)) {
      visited.add(port.index);
      const other = ports[port.index][port.start ? 1 : 0];
      chain.push({ index: port.index, reversed: !port.start, from: points.length - 1, to: points.length });
      points.push(other.point.clone().setY(other.top));
      const node = nodes.find(list => list.includes(other))!;
      if (node.length !== 2) break;
      port = node.find(p => p !== other)!;
    }
    const style = canonicalRailingStyle(sections[first.index].style);
    const paths = smoothHandrailPath(points, chain, style === "marble" ? 140 : style === "wood" ? 90 : 55);
    chain.forEach((span, i) => handrails[span.index] = span.reversed
      ? paths[i].reverse().map(sample => ({ point: sample.point, tangent: sample.tangent.clone().negate() })) : paths[i]);
  };
  for (const node of nodes.filter(list => list.length !== 2)) for (const port of node) if (!visited.has(port.index)) trace(port);
  for (const pair of ports) if (!visited.has(pair[0].index)) trace(pair[0]);
  return {
    sections, joints, handrails,
    signature: (indices: number[]) => JSON.stringify(indices.map(index => [sections[index], joints[index], handrails[index]])),
    render(parent: THREE.Object3D, indices = sections.map((_, index) => index)) {
      return indices.map(index => {
        const s = sections[index];
        return railingModel(parent, s.a, s.b, s.style, s.height, s.footing, joints[index], s.startHeight, s.endHeight, handrails[index]);
      });
    },
  };
}
