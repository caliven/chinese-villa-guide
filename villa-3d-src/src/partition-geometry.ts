import type { Wall } from "./data";
import { interiorOpeningProfile } from "./openings";
import { stairSoffitClearHeight, type StairSoffitGeom } from "./primitives";

/** 户型三维和完整房屋共用的隔墙净高，标高始终相对本层完成面。 */
export function partitionProfile(part: Wall, storyHeight: number, stair?: StairSoffitGeom, ceilingGap = 150) {
  let height = Math.max(0, storyHeight - ceilingGap);
  if (stair) {
    const clearances: number[] = [];
    for (let i = 0; i <= 8; i++) {
      const clear = stairSoffitClearHeight(part.a[0] + (part.b[0] - part.a[0]) * i / 8,
        part.a[1] + (part.b[1] - part.a[1]) * i / 8, stair, storyHeight);
      if (clear != null) clearances.push(clear);
    }
    if (clearances.length >= 4) height = Math.min(height, Math.max(900, Math.min(...clearances) - 30));
  }
  return { height, opening: part.door ? interiorOpeningProfile(part.door, height) : undefined };
}
