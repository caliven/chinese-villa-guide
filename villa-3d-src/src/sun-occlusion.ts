import * as THREE from "three";

type Blocker = { mesh: THREE.Mesh; bounds: THREE.Box3; center: THREE.Vector3 };
type Branch = { bounds: THREE.Box3; children?: [Branch, Branch]; blockers?: Blocker[] };

/**
 * 为本次日照计算建立包围盒树。实例瓦片／树叶的世界矩阵只展开一次，
 * 命中的叶节点继续调用 Three.js 原生 raycast，保留材质面向、洞口与真实几何。
 */
export function sunOcclusion(meshes: THREE.Mesh[]) {
  const blockers: Blocker[] = [];
  const localMatrix = new THREE.Matrix4();
  const add = (mesh: THREE.Mesh) => {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const bounds = mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
    if (!bounds.isEmpty()) blockers.push({ mesh, bounds, center: bounds.getCenter(new THREE.Vector3()) });
  };
  for (const mesh of meshes) {
    if (mesh instanceof THREE.InstancedMesh) {
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, localMatrix);
        const instance = new THREE.Mesh(mesh.geometry, mesh.material);
        instance.matrixWorld.multiplyMatrices(mesh.matrixWorld, localMatrix);
        instance.matrixAutoUpdate = false;
        add(instance);
      }
    } else add(mesh);
  }

  const build = (items: Blocker[]): Branch => {
    const bounds = new THREE.Box3();
    for (const item of items) bounds.union(item.bounds);
    if (items.length <= 8) return { bounds, blockers: items };
    const size = bounds.getSize(new THREE.Vector3());
    const axis = size.x >= size.y && size.x >= size.z ? "x" : size.y >= size.z ? "y" : "z";
    items.sort((a, b) => a.center[axis] - b.center[axis]);
    const middle = Math.floor(items.length / 2);
    return { bounds, children: [build(items.slice(0, middle)), build(items.slice(middle))] };
  };
  const root = build(blockers);
  const hits: THREE.Intersection[] = [];
  const blocked = (raycaster: THREE.Raycaster, branch: Branch): boolean => {
    if (!raycaster.ray.intersectsBox(branch.bounds)) return false;
    if (branch.children) return blocked(raycaster, branch.children[0]) || blocked(raycaster, branch.children[1]);
    for (const item of branch.blockers!) {
      if (!raycaster.ray.intersectsBox(item.bounds)) continue;
      hits.length = 0;
      item.mesh.raycast(raycaster, hits);
      if (hits.length) return true;
    }
    return false;
  };
  return (raycaster: THREE.Raycaster) => blocked(raycaster, root);
}
