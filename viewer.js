// OfficeTwin interactive viewer (Three.js, vendored locally).
// Blob format: uint32 header_len | JSON header | float32 pos[n*3] | uint8 col[n*3] | (mesh) uint32 idx[m*3] | (inst) uint8 inst[n]
import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { otFetch } from './fetch.js?v=6';

export async function loadBlob(url, onProgress) {
  const buf = await otFetch(url, onProgress);
  const dv = new DataView(buf.buffer);
  const hl = dv.getUint32(0, true);
  const hdr = JSON.parse(new TextDecoder().decode(buf.subarray(4, 4 + hl)));
  let off = 4 + hl;
  const n = hdr.n;
  if (hdr.type === 'poses') return { hdr, data: new Float32Array(buf.buffer.slice(off, off + n * 48)) };
  const pos = new Float32Array(buf.buffer.slice(off, off + n * 12)); off += n * 12;
  const col = new Uint8Array(buf.buffer.slice(off, off + n * 3)); off += n * 3;
  let idx = null, inst = null;
  if (hdr.type === 'mesh') { idx = new Uint32Array(buf.buffer.slice(off, off + hdr.m * 12)); off += hdr.m * 12; }
  if (hdr.inst || hdr.labelled) { inst = new Uint8Array(buf.buffer.slice(off, off + n)); off += n; }
  return { hdr, pos, col, idx, inst };
}

const POINT_VS = `
  attribute vec3 color; attribute float inst;
  uniform float uSize, uMaxY, uHide, uHighlight, uScale;
  varying vec3 vColor; varying float vKill;
  void main() {
    vColor = color;
    vKill = 0.0;
    if (position.y > uMaxY) vKill = 1.0;
    if (uHide > 0.5 && abs(inst - uHide) < 0.5) vKill = 1.0;
    if (uHighlight > 0.5 && abs(inst - uHighlight) > 0.5) vColor = mix(vColor, vec3(0.85), 0.75);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(0.01 * uSize * uScale / -mv.z, 1.0, 18.0);
  }`;
const POINT_FS = `
  varying vec3 vColor; varying float vKill; uniform float uOpacity;
  void main() {
    if (vKill > 0.5) discard;
    vec2 d = gl_PointCoord - 0.5; if (dot(d, d) > 0.25) discard;
    gl_FragColor = vec4(vColor, uOpacity);
  }`;

export function createViewer(container, opts = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(opts.background ?? 0xf4f5f7);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 500);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);
  renderer.domElement.style.display = 'block';
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.95;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(8, 14, 6); scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(-8, 6, -10); scene.add(fill);

  const objects = {}; const pointMats = [];
  let needs = true;
  const pxScale = () => (container.clientHeight || 600) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    for (const m of pointMats) m.uniforms.uScale.value = pxScale();
    needs = true;
  }
  new ResizeObserver(resize).observe(container); resize();
  controls.addEventListener('change', () => { needs = true; });
  let running = true;
  (function loop() { if (!running) return; requestAnimationFrame(loop); controls.update(); if (needs || controls.enableDamping) { renderer.render(scene, camera); needs = false; } })();

  function frame(bbox, opt = {}) {
    restoreFov();
    const [mn, mx] = bbox;
    const c = new THREE.Vector3((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2);
    const size = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
    const dir = new THREE.Vector3(...(opt.dir ?? [0.55, 0.75, 0.6])).normalize();
    camera.position.copy(c).addScaledVector(dir, size * (opt.dist ?? 1.15));
    controls.target.copy(c); camera.near = size / 500; camera.far = size * 20; camera.updateProjectionMatrix();
    controls.update(); needs = true;
  }

  function addMesh(name, blob, o = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(blob.pos, 3));
    const cf = new Float32Array(blob.col.length); for (let i = 0; i < cf.length; i++) cf[i] = blob.col[i] / 255;
    g.setAttribute('color', new THREE.BufferAttribute(cf, 3));
    g.setIndex(new THREE.BufferAttribute(blob.idx, 1));
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true, roughness: 0.85, metalness: 0.0, transparent: true, opacity: o.opacity ?? 1 });
    const mesh = new THREE.Mesh(g, mat);
    mesh.userData = { blob, fullIndex: blob.idx, uniformColor: null };
    if (o.uniform) setMeshUniform(mesh, o.uniform);
    scene.add(mesh); objects[name] = mesh; needs = true; return mesh;
  }
  function setMeshUniform(mesh, color) {
    const g = mesh.geometry, b = mesh.userData.blob, cf = g.getAttribute('color');
    if (color) { const c = new THREE.Color(color); for (let i = 0; i < b.pos.length / 3; i++) cf.setXYZ(i, c.r, c.g, c.b); }
    else for (let i = 0; i < b.pos.length / 3; i++) cf.setXYZ(i, b.col[3 * i] / 255, b.col[3 * i + 1] / 255, b.col[3 * i + 2] / 255);
    cf.needsUpdate = true; needs = true;
  }
  function isolateMesh(mesh, cid) {
    const b = mesh.userData.blob;
    if (!cid || !b.inst) { mesh.geometry.setIndex(new THREE.BufferAttribute(b.idx, 1)); needs = true; return; }
    const keep = [];
    for (let t = 0; t < b.idx.length; t += 3) if (b.inst[b.idx[t]] === cid) keep.push(b.idx[t], b.idx[t + 1], b.idx[t + 2]);
    mesh.geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(keep), 1)); needs = true;
  }
  function addPoints(name, blob, o = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(blob.pos, 3));
    const cf = new Float32Array(blob.col.length); for (let i = 0; i < cf.length; i++) cf[i] = blob.col[i] / 255;
    g.setAttribute('color', new THREE.BufferAttribute(cf, 3));
    const inst = new Float32Array(blob.pos.length / 3);
    if (blob.inst) for (let i = 0; i < inst.length; i++) inst[i] = blob.inst[i];
    g.setAttribute('inst', new THREE.BufferAttribute(inst, 1));
    const mat = new THREE.ShaderMaterial({ vertexShader: POINT_VS, fragmentShader: POINT_FS, transparent: true, depthWrite: true,
      uniforms: { uSize: { value: o.size ?? 2.0 }, uMaxY: { value: o.maxY ?? 1e9 }, uHide: { value: 0 }, uHighlight: { value: 0 }, uOpacity: { value: o.opacity ?? 1 }, uScale: { value: pxScale() } } });
    pointMats.push(mat);
    const pts = new THREE.Points(g, mat); pts.userData = { blob };
    scene.add(pts); objects[name] = pts; needs = true; return pts;
  }
  function addLine(name, blob, color = 0xff8c00) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(blob.pos, 3));
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color, linewidth: 2 }));
    scene.add(line); objects[name] = line; needs = true; return line;
  }
  // poses blob: per camera 12 floats = R (row-major 3x3, viewer frame, z forward / y down) + t
  function frustumLines(poses, idxList, depth) {
    const [fx, fy, cx, cy, W, H] = poses.hdr.K, d = poses.data;
    const cornersCam = [[0, 0], [W, 0], [W, H], [0, H]].map(([u, v]) => [(u - cx) / fx * depth, (v - cy) / fy * depth, depth]);
    const out = new Float32Array(idxList.length * 16 * 3); let o = 0;
    const put = (p) => { out[o++] = p[0]; out[o++] = p[1]; out[o++] = p[2]; };
    for (const i of idxList) {
      const b = i * 12, R = d.subarray(b, b + 9), t = [d[b + 9], d[b + 10], d[b + 11]];
      const k = cornersCam.map(([x, y, z]) => [t[0] + R[0] * x + R[1] * y + R[2] * z, t[1] + R[3] * x + R[4] * y + R[5] * z, t[2] + R[6] * x + R[7] * y + R[8] * z]);
      for (let j = 0; j < 4; j++) { put(t); put(k[j]); }
      for (let j = 0; j < 4; j++) { put(k[j]); put(k[(j + 1) % 4]); }
    }
    return out;
  }
  function addFrustums(name, poses, o = {}) {
    const idx = o.indices ?? Array.from({ length: poses.hdr.n }, (_, i) => i);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(frustumLines(poses, idx, o.depth ?? 0.25), 3));
    const ls = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: o.color ?? 0x3b6fd6, transparent: true, opacity: o.opacity ?? 0.55 }));
    remove(name); scene.add(ls); objects[name] = ls; needs = true; return ls;
  }
  function poseOf(poses, i) {
    const b = i * 12, d = poses.data;
    const m = new THREE.Matrix4().set(d[b], d[b + 1], d[b + 2], d[b + 9], d[b + 3], d[b + 4], d[b + 5], d[b + 10], d[b + 6], d[b + 7], d[b + 8], d[b + 11], 0, 0, 0, 1);
    return m;
  }
  let savedFov = null;
  function lookFromPose(poses, i) {
    const m = poseOf(poses, i);
    const t = new THREE.Vector3().setFromMatrixPosition(m);
    const fwd = new THREE.Vector3(0, 0, 1).transformDirection(m);
    // camera convention: x right, y down, z forward  ->  three.js camera: x right, y up, looks down -z
    const flip = new THREE.Matrix4().makeScale(1, -1, -1);
    const rot = new THREE.Matrix4().extractRotation(m).multiply(flip);
    if (savedFov === null) savedFov = camera.fov;
    const [, fy, , cy] = poses.hdr.K;
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(cy / fy)); camera.updateProjectionMatrix();
    camera.position.copy(t); camera.quaternion.setFromRotationMatrix(rot);
    controls.target.copy(t).addScaledVector(fwd, 1.5); controls.update(); needs = true;
  }
  function restoreFov() { if (savedFov !== null) { camera.fov = savedFov; camera.updateProjectionMatrix(); savedFov = null; needs = true; } }
  function addGrid(size = 30, y = 0) {
    const grid = new THREE.GridHelper(size, size, 0xbbbbbb, 0xdddddd); grid.position.y = y - 0.005; scene.add(grid); objects.grid = grid; needs = true; return grid;
  }
  function remove(name) { const o = objects[name]; if (o) { scene.remove(o); o.geometry?.dispose(); delete objects[name]; needs = true; } }
  function setVisible(name, v) { if (objects[name]) { objects[name].visible = v; needs = true; } }
  function redraw() { needs = true; }
  function dispose() { running = false; for (const k of Object.keys(objects)) remove(k); controls.dispose(); renderer.dispose(); renderer.domElement.remove(); }
  return { scene, camera, renderer, controls, objects, frame, addMesh, addPoints, addLine, addFrustums, lookFromPose, restoreFov, addGrid, remove, setVisible, setMeshUniform, isolateMesh, redraw, dispose, THREE };
}

export function fmtMB(b) { return (b / 1048576).toFixed(1) + ' MB'; }
