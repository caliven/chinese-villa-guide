import type { Group, Material } from "three";
import type { FloorplanFurnitureType } from "../floorplan-catalog";

export function furnSVG(type: FloorplanFurnitureType, w: number, d: number, color: string): string;
export function buildFurniture(item: {
  type: FloorplanFurnitureType; w: number; d: number; color: string; cx: number; cy: number;
}, glassMaterial?: Material): Group;

