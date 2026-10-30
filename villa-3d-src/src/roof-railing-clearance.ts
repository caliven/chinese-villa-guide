import * as THREE from "three";

/** 将栏杆限制在四坡瓦面内侧；坐标及安全余量均为毫米。 */
export function clipRailingBelowRoof(root: THREE.Object3D, roof: { x: number; z: number; w: number; d: number; eave: number; slope: number }, clearance = 100) {
  root.updateWorldMatrix(true, true);
  const planes = [
    (p: THREE.Vector3) => roof.eave + roof.slope * (p.x - roof.x) - clearance - p.y,
    (p: THREE.Vector3) => roof.eave + roof.slope * (roof.x + roof.w - p.x) - clearance - p.y,
    (p: THREE.Vector3) => roof.eave + roof.slope * (p.z - roof.z) - clearance - p.y,
    (p: THREE.Vector3) => roof.eave + roof.slope * (roof.z + roof.d - p.z) - clearance - p.y,
  ];
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const source = object.geometry as THREE.BufferGeometry;
    const position = source.getAttribute("position");
    if (!position) return;
    const world = new THREE.Vector3();
    let requiresClip = false;
    for (let i = 0; i < position.count && !requiresClip; i++) {
      world.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
      requiresClip = planes.some(plane => plane(world) < 0);
    }
    if (!requiresClip) return;
    const geometry = source.index ? source.toNonIndexed() : source;
    const names = Object.keys(geometry.attributes);
    const attributes = names.map(name => geometry.getAttribute(name));
    type Vertex = { values: number[][]; world: THREE.Vector3 };
    const vertex = (index: number): Vertex => ({
      values: attributes.map(attribute => Array.from({ length: attribute.itemSize }, (_, i) => attribute.getComponent(index, i))),
      world: new THREE.Vector3().fromBufferAttribute(geometry.getAttribute("position"), index).applyMatrix4(object.matrixWorld),
    });
    const lerp = (a: Vertex, b: Vertex, t: number): Vertex => ({
      values: a.values.map((values, i) => values.map((value, j) => value + (b.values[i][j] - value) * t)),
      world: a.world.clone().lerp(b.world, t),
    });
    const output = names.map(() => [] as number[]);
    for (let i = 0; i < geometry.getAttribute("position").count; i += 3) {
      let polygon = [vertex(i), vertex(i + 1), vertex(i + 2)];
      for (const plane of planes) {
        const next: Vertex[] = [];
        for (let j = 0; j < polygon.length; j++) {
          const a = polygon[j], b = polygon[(j + 1) % polygon.length], da = plane(a.world), db = plane(b.world);
          if (da >= 0) next.push(a);
          if ((da >= 0) !== (db >= 0)) next.push(lerp(a, b, da / (da - db)));
        }
        polygon = next;
        if (!polygon.length) break;
      }
      for (let j = 1; j + 1 < polygon.length; j++)
        for (const point of [polygon[0], polygon[j], polygon[j + 1]])
          point.values.forEach((values, k) => output[k].push(...values));
    }
    const clipped = new THREE.BufferGeometry();
    names.forEach((name, i) => clipped.setAttribute(name, new THREE.Float32BufferAttribute(output[i], attributes[i].itemSize)));
    clipped.computeBoundingBox(); clipped.computeBoundingSphere();
    object.geometry = clipped;
    if (geometry !== source) geometry.dispose();
  });
}

/** 完整栏杆用于屋面隐藏和剖视，避让版本用于显示坡屋面。 */
export function roofRailingVariants(parent: THREE.Object3D, render: (group: THREE.Group) => void, roof: Parameters<typeof clipRailingBelowRoof>[1]) {
  const open = new THREE.Group();
  open.name = "完整楼梯栏杆"; open.userData.roofRailingMode = "open"; open.visible = false;
  parent.add(open); render(open);
  const covered = open.clone(true);
  covered.name = "屋面避让栏杆"; covered.userData.roofRailingMode = "covered"; covered.visible = true;
  parent.add(covered);
  clipRailingBelowRoof(covered, roof);
}
