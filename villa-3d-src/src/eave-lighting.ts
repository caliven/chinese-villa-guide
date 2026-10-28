import * as THREE from "three";

export type EaveLightEdge = {
  along: "x" | "z"; face: number; from: number; to: number; sign: number;
  fasciaFrom?: number; fasciaTo?: number;
};

/** 同一折线的相邻灯带在外侧偏移线的交点相接，兼容阳角和阴角。 */
export function eaveLightSpans(edges: EaveLightEdge[], projection: number, offset: number) {
  return edges.map((edge, index) => {
    const endAt = (t: number) => {
      const other = edges.find((candidate, i) => i !== index && candidate.along !== edge.along
        && [candidate.from, candidate.to].some(value => Math.abs(value - edge.face) < 0.1)
        && Math.abs(candidate.face - t) < 0.1);
      if (other) return other.face + other.sign * offset;
      const explicit = t === edge.from ? edge.fasciaFrom : edge.fasciaTo;
      if (explicit === undefined) return t;
      return explicit + Math.sign(explicit - t) * (offset - projection);
    };
    return { from: endAt(edge.from), to: endAt(edge.to) };
  });
}

/** 示意灯带及贴近墙面的渐隐光晕，坐标单位为毫米。 */
export function addEaveWash(
  parent: THREE.Object3D,
  edge: EaveLightEdge,
  fasciaTop: number,
  soffitY: number,
  projection: number,
  stripSpan = { from: edge.from, to: edge.to },
  washSpan = stripSpan,
) {
  const length = stripSpan.to - stripSpan.from;
  if (length <= 0) return;
  const washHeight = Math.max(1, soffitY - fasciaTop);
  const group = new THREE.Group();
  group.name = "檐下洗墙灯";
  group.userData.eaveWash = true;
  group.visible = false;
  parent.add(group);

  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(length, 24),
    new THREE.MeshBasicMaterial({ color: 0xffd99a, transparent: true, opacity: 0.96, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
  );
  strip.name = "暖白灯带";
  const wash = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.max(0.001, washSpan.to - washSpan.from), washHeight),
    new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { washColor: { value: new THREE.Vector3(1, 0.56, 0.22) }, brightness: { value: 1 } },
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `
        #include <logdepthbuf_pars_fragment>
        varying vec2 vUv;
        uniform vec3 washColor;
        uniform float brightness;
        void main() {
          #include <logdepthbuf_fragment>
          float a = min(1.0, pow(1.0 - vUv.y, 1.3) * 0.78 * brightness);
          gl_FragColor = vec4(washColor, a);
        }`,
    }),
  );
  wash.name = "洗墙渐隐光晕";
  const mid = (stripSpan.from + stripSpan.to) / 2;
  const washMid = (washSpan.from + washSpan.to) / 2;
  if (edge.along === "x") {
    strip.position.set(mid, fasciaTop + 12, edge.face + edge.sign * (projection + 2));
    wash.position.set(washMid, fasciaTop + washHeight / 2, edge.face + edge.sign * (projection + 4));
  } else {
    strip.rotation.y = wash.rotation.y = Math.PI / 2;
    strip.position.set(edge.face + edge.sign * (projection + 2), fasciaTop + 12, mid);
    wash.position.set(edge.face + edge.sign * (projection + 4), fasciaTop + washHeight / 2, washMid);
  }
  group.add(strip, wash);
}

export function setEaveWashVisible(root: THREE.Object3D, visible: boolean) {
  root.traverse(object => { if (object.userData.eaveWash) object.visible = visible; });
}

/** 修改所有灯带和光晕，保留夜景显示状态；重建后同样调用。 */
export function setEaveWashAppearance(root: THREE.Object3D, color: string, brightness: number, night = false) {
  const hex = /^#[0-9a-f]{6}$/i.test(color) ? color : "#ff7030";
  const strength = THREE.MathUtils.clamp(Number.isFinite(brightness) ? brightness : 1, 0, 2);
  const rgb = Number.parseInt(hex.slice(1), 16);
  // 默认暖白灯管保留最初的暖琥珀色洗墙光；其他颜色按用户所选颜色呈现。
  const glowColor = hex.toLowerCase() === "#ffd99a"
    ? [1, 0.56, 0.22]
    : [((rgb >> 16) & 255) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255];
  root.traverse(object => {
    if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshStandardMaterial && object.material.userData.eaveLitCorbel) {
      object.material.emissive.setRGB(glowColor[0], glowColor[1], glowColor[2]);
      object.material.emissiveIntensity = night ? strength * 0.16 : 0;
    }
    if (!object.userData.eaveWash) return;
    const strip = object.getObjectByName("暖白灯带") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    const wash = object.getObjectByName("洗墙渐隐光晕") as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    strip.material.color.set(hex).multiplyScalar(Math.min(1, strength));
    strip.material.opacity = Math.min(0.96, strength * 0.96);
    wash.material.uniforms.washColor.value.set(glowColor[0], glowColor[1], glowColor[2]);
    wash.material.uniforms.brightness.value = strength;
  });
}
