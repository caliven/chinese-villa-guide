import type { Point } from "./data";

/** 柱头外展为外观建议尺寸；轮廓供三维及四向立面共同使用。 */
export type ColumnCourse = { bottom: number; top: number; lower: Point[]; upper: Point[]; dark?: boolean };

export function octagonalOutline(w: number, d: number): Point[] {
  const c = Math.min(w, d) * .065;
  return [[-w/2+c,-d/2],[w/2-c,-d/2],[w/2,-d/2+c],[w/2,d/2-c],
    [w/2-c,d/2],[-w/2+c,d/2],[-w/2,d/2-c],[-w/2,-d/2+c]];
}

export function cornerOutline(project: number, leg: number, outward: number, lip = 0): Point[] {
  const outer = outward * (project + lip), inner = -outward * (leg + lip);
  return [[inner,-project-lip],[outer,-project-lip],[outer,leg+lip],
    [-outward*20,leg+lip],[-outward*20,20],[inner,20]];
}

function shoulder(bottom: number, top: number, outline: (lip: number) => Point[], start: number): ColumnCourse[] {
  const h = top - bottom;
  return [
    { bottom, top: bottom + h * .72, lower: outline(start), upper: outline(start + 50) },
    { bottom: bottom + h * .72, top, lower: outline(start + 60), upper: outline(start + 60) },
  ];
}

export const porticoShoulderProfile = (w: number, d: number, bottom: number, top: number) =>
  shoulder(bottom, top, lip => octagonalOutline(w + lip * 2, d + lip * 2), 50);

export const cornerShoulderProfile = (project: number, leg: number, outward: number, bottom: number, top: number) =>
  shoulder(bottom, top, lip => cornerOutline(project, leg, outward, lip), 40);

/** 三楼四柱采用同一组冠部线脚，团寿、黑箍及回纹的位置与下层包角柱对应。 */
function upperCrownProfile(outline: (lip: number) => Point[], height: number): ColumnCourse[] {
  return [
    { bottom: height - 850, top: height - 810, lower: outline(20), upper: outline(20) },
    { bottom: height - 670, top: height - 630, lower: outline(30), upper: outline(30) },
    { bottom: height - 630, top: height - 490, lower: outline(30), upper: outline(5) },
    { bottom: height - 490, top: height - 460, lower: outline(32), upper: outline(32) },
    { bottom: height - 460, top: height - 380, lower: outline(12), upper: outline(12), dark: true },
    { bottom: height - 380, top: height - 350, lower: outline(25), upper: outline(25) },
    { bottom: height - 350, top: height - 120, lower: outline(0), upper: outline(45) },
    { bottom: height - 120, top: height - 70, lower: outline(65), upper: outline(65), dark: true },
    { bottom: height - 70, top: height, lower: outline(90), upper: outline(90), dark: true },
  ];
}

export function upperCornerProfile(project: number, leg: number, outward: number, height: number): ColumnCourse[] {
  const outline = (lip: number) => cornerOutline(project, leg, outward, lip);
  return [
    { bottom: 0, top: height - 120, lower: outline(0), upper: outline(0) },
    { bottom: 0, top: 100, lower: outline(35), upper: outline(35) },
    { bottom: 100, top: 155, lower: outline(25), upper: outline(0) },
    ...upperCrownProfile(outline, height),
  ];
}

export const hatPierDesign = { depth: 500, capHeight: 120, capOverhang: 90, capDepth: 680 };

export function hatPierCrownProfile(width: number, height: number): ColumnCourse[] {
  const outline = (lip: number) => octagonalOutline(width + lip * 2, hatPierDesign.depth + lip * 2);
  return upperCrownProfile(outline, height);
}
