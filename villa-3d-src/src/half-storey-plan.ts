import { floors, site } from "./data";
import { halfStoreyRoof } from "./half-storey";

/** 按模型坡下220预留估算，供讨论；不代替结构与装修后的净高。 */
export function halfStoreyClearanceZones() {
  const roof = halfStoreyRoof(), floor = floors[2], m = site.main;
  return [1500, 2100].map(height => {
    const inset = Math.max(0, (floor.y + height + 220 - roof.eave) / roof.slope);
    const x = Math.max(m.x + 240, roof.x + inset), z = Math.max(floor.front + 240, roof.z + inset);
    return { height, x, z, w: Math.max(0, Math.min(m.x + m.w - 240, roof.x + roof.w - inset) - x),
      d: Math.max(0, Math.min(m.z + m.d - 240, roof.z + roof.d - inset) - z) };
  }).filter(zone => zone.w > 0 && zone.d > 0);
}
