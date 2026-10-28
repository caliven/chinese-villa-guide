import * as THREE from "three";
import { site, type Floor, type Point } from "./data";
import type { StairDraft, VoidDraft } from "./layout-draft";
import { livingVoidGuards, stairFloorGuards, type GuardSegment } from "./interior-guards";
import { resolvedRailingStyle, type RailingStyle } from "./railing-options";
import { railingNetwork, type RailingSection } from "./railing-network";
import { stairRailingSections } from "./stair-railing";

/** 先计算全楼栏杆拓扑；分层、来梯副本与完整房屋使用同一组接缝及柱子归属。 */
export function interiorRailingLayout(floors: Floor[], stair: StairDraft, living: VoidDraft, facades: { a: Point; b: Point }[][], hasStair: boolean) {
  const livingStyle = resolvedRailingStyle(living.railingStyle, "living"), stairStyle = resolvedRailingStyle(stair.railingStyle, "stair");
  const sections: RailingSection[] = [];
  const append = (items: RailingSection[]) => items.map(item => { sections.push(item); return sections.length - 1; });
  const guards = (items: GuardSegment[], y: number, style: RailingStyle, connectionGroup: string) => append(items.map(([a, b]) => ({
    a: new THREE.Vector3(a[0], y, a[1]), b: new THREE.Vector3(b[0], y, b[1]),
    height: 1100, style, connectionGroup, postPriority: 10,
  })));
  const stories = floors.map((floor, index) => hasStair && index < floors.length - 1
    ? append(stairRailingSections(stair, floor.y + (index === 0 ? site.entranceRise : 0), floor.height - (index === 0 ? site.entranceRise : 0), stairStyle)) : []);
  const livingGuards = floors.map((floor, index) => index === 1
    ? guards(livingVoidGuards(living, floor, facades[index], livingStyle, hasStair ? stair : undefined), floor.y, livingStyle, "living") : []);
  const stairGuards = floors.map((floor, index) => hasStair && index > 0
    ? guards(stairFloorGuards(stair, floor, facades[index], stairStyle, index === 1 ? living : undefined), floor.y, stairStyle, "stair") : []);
  const network = railingNetwork(sections);
  return { ...network, stories, livingGuards, stairGuards,
    floorSignature: (index: number) => network.signature([...stories[index], ...livingGuards[index], ...stairGuards[index], ...(stories[index - 1] ?? [])]),
  };
}
