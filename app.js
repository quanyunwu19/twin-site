// OfficeTwin site shell: hash router (one page in the DOM at a time), zh/en switch, viewer lifecycle.
import { createViewer, loadBlob, fmtMB } from './viewer.js?v=6';
import { isStatic, tryRemembered, unlock, otText, otURL, sizeOf } from './fetch.js?v=6';

const PAGES = ['overview', 'motivation', 'p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'viewer', 'eval', 'sim', 'demo', 'ext', 'failures'];
const I18N = {
  zh: {
    nav: { overview: '总览', motivation: '0 问题', p0: 'P0 尺度', p1: 'P1 拓扑', p2: 'P2 分割', p3: 'P3 配准', p4: 'P4 共识', p5: 'P5 实体', viewer: '3D 查看器', eval: '对比/消融', sim: '仿真验证', demo: '视频', ext: '后续扩展', failures: '失败记录' },
    links: { viewer: '🧊 交互式 3D 查看器', demo: '🎬 对比视频', failures: '⚠ 失败与弯路记录' },
    langBtn: 'English', prev: '← 上一页', next: '下一页 →', loading: '加载中…', fail: '加载失败: ',
    footer: 'OfficeTwin research site · 托管在 lilac.uwaterloo.ca · 源文件 <code>/pub2/danielwu/OfficeTwin_Site/</code> · 流水线代码 <code>/pub2/danielwu/OfficeTwin_Final/</code>',
    footerStatic: 'OfficeTwin research site · 静态加密版（内容在浏览器内用访问密码解密）· 源站 lilac.uwaterloo.ca:8000',
    gate: { sub: '请输入访问密码', ph: '密码', btn: '进入', err: '密码错误', busy: '解密中…' }, vid: (mb) => `▶ 加载视频（${mb}）`, vidDl: '下载视频 ',
    v: { mesh: '加载实体…', pts: '加载点云…', dl: '下载中 ', hi: '160 万', lo: '45 万', pts2: ' 点 · 41k 三角面 · 23 实体', hiDone: '已加载 160 万点', cub: '工位 #', L: '（L 形）', kf: '关键帧 → 工位 #', notkf: '非关键帧', cstat: (t, n, m) => `${t} 形 · ${n} 点 · ${m} 三角面 (watertight)` },
  },
  en: {
    nav: { overview: 'Overview', motivation: '0 Problem', p0: 'P0 Scale', p1: 'P1 Topology', p2: 'P2 Segmentation', p3: 'P3 Registration', p4: 'P4 Consensus', p5: 'P5 Solids', viewer: '3D Viewer', eval: 'Comparison', sim: 'Simulation', demo: 'Video', ext: 'Extensions', failures: 'Failures' },
    links: { viewer: '🧊 Interactive 3D viewer', demo: '🎬 Comparison video', failures: '⚠ Failures & dead ends' },
    langBtn: '中文', prev: '← Previous', next: 'Next →', loading: 'Loading…', fail: 'Failed to load: ',
    footer: 'OfficeTwin research site · hosted on lilac.uwaterloo.ca · sources <code>/pub2/danielwu/OfficeTwin_Site/</code> · pipeline code <code>/pub2/danielwu/OfficeTwin_Final/</code>',
    footerStatic: 'OfficeTwin research site · static encrypted build (content is decrypted in your browser with the access password) · origin lilac.uwaterloo.ca:8000',
    gate: { sub: 'Enter the access password', ph: 'password', btn: 'Enter', err: 'wrong password', busy: 'decrypting…' }, vid: (mb) => `▶ Load video (${mb})`, vidDl: 'downloading video ',
    v: { mesh: 'loading mesh…', pts: 'loading points…', dl: 'downloading ', hi: '1.6 M', lo: '450 k', pts2: ' points · 41k tris · 23 solids', hiDone: '1.6 M points loaded', cub: 'cubicle #', L: ' (L-shaped)', kf: 'keyframe → cubicle #', notkf: 'not a keyframe', cstat: (t, n, m) => `${t}-type · ${n} points · ${m} tris (watertight)` },
  },
};

let lang = localStorage.getItem('ot-lang') || (navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en');
let current = null, viewers = [];
let hero = null;  // pages/hero.json (author list + abstract), loaded after the gate
const $ = (id) => document.getElementById(id);
const T = () => I18N[lang];

function renderShell() {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  $('hero-sub').innerHTML = hero ? hero[lang].sub : ''; $('hero-meta').innerHTML = hero ? hero[lang].meta : ''; $('footer').innerHTML = isStatic() ? T().footerStatic : T().footer;
  for (const [k, v] of Object.entries(T().links)) $('lnk-' + k).textContent = v;
  $('lang-btn').textContent = T().langBtn;
  const nav = $('nav'); nav.innerHTML = '';
  for (const p of PAGES) { const a = document.createElement('a'); a.href = '#' + p; a.textContent = T().nav[p]; a.dataset.page = p; if (p === current) a.classList.add('active'); nav.appendChild(a); }
}

function disposeViewers() { for (const v of viewers) { try { v.dispose(); } catch (e) { /* ignore */ } } viewers = []; }

async function show(id) {
  if (!PAGES.includes(id)) id = 'overview';
  disposeViewers();
  current = id;
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.page === id));
  const main = $('page'); main.innerHTML = `<p class="loading">${T().loading}</p>`;
  try {
    main.innerHTML = await otText(`pages/${id}.${lang}.html`);
    if (isStatic()) resolveMedia(main);
  } catch (e) { main.innerHTML = `<p class="loading">${T().fail}${e.message}</p>`; return; }
  const i = PAGES.indexOf(id), pager = document.createElement('div'); pager.className = 'pager';
  pager.innerHTML = (i > 0 ? `<a href="#${PAGES[i - 1]}">${T().prev} ${T().nav[PAGES[i - 1]]}</a>` : '<span></span>') + (i < PAGES.length - 1 ? `<a href="#${PAGES[i + 1]}">${T().nav[PAGES[i + 1]]} ${T().next}</a>` : '<span></span>');
  main.appendChild(pager);
  window.scrollTo({ top: 0 });
  if ($('scene-viewer')) sceneViewer();
  if ($('canon-viewer')) canonViewer();
  if (new URLSearchParams(location.search).has('autoload')) document.querySelectorAll('.loadbtn button').forEach((b) => b.click());
}

function route() { show((location.hash || '#overview').slice(1)); }
$('lang-btn').onclick = () => { lang = lang === 'zh' ? 'en' : 'zh'; localStorage.setItem('ot-lang', lang); renderShell(); route(); };
window.addEventListener('hashchange', route);
boot();

async function boot() {
  if (!(await tryRemembered())) await gate();
  try { hero = JSON.parse(await otText('pages/hero.json')); } catch (e) { console.error(e); }
  renderShell(); route();
}

// ---------------------------------------------------------------- static build: password gate + media decryption
function gate() {
  return new Promise((resolve) => {
    const g = T().gate, el = document.createElement('div'); el.id = 'gate';
    el.innerHTML = `<form class="box"><h1>OfficeTwin</h1><div class="s">${I18N.zh.gate.sub} · ${I18N.en.gate.sub}</div><div class="err" id="gate-err"></div>
      <input type="password" id="gate-pw" placeholder="${I18N.zh.gate.ph} / ${I18N.en.gate.ph}" autofocus autocomplete="current-password"><button type="submit" id="gate-btn">${I18N.zh.gate.btn} · ${I18N.en.gate.btn}</button></form>`;
    document.body.appendChild(el);
    el.querySelector('form').onsubmit = async (e) => {
      e.preventDefault(); const btn = $('gate-btn'); btn.disabled = true; btn.textContent = g.busy; $('gate-err').textContent = '';
      try { await unlock($('gate-pw').value); el.remove(); resolve(); }
      catch (err) { $('gate-err').textContent = `${I18N.zh.gate.err} · ${I18N.en.gate.err}`; btn.disabled = false; btn.textContent = `${I18N.zh.gate.btn} · ${I18N.en.gate.btn}`; $('gate-pw').select(); }
    };
  });
}
function resolveMedia(root) {
  root.querySelectorAll('img[src^="assets/"]').forEach(async (img) => {
    const src = img.getAttribute('src'); img.removeAttribute('src'); img.classList.add('decrypting');
    try { img.src = await otURL(src); } catch (e) { img.alt = T().fail + e.message; } img.classList.remove('decrypting');
  });
  root.querySelectorAll('video[src^="assets/"]').forEach((v) => {
    const src = v.getAttribute('src'); v.removeAttribute('src');
    const btn = document.createElement('button'); btn.className = 'vidload'; btn.type = 'button'; btn.textContent = T().vid(fmtMB(sizeOf(src)));
    v.parentNode.insertBefore(btn, v);
    btn.onclick = async () => {
      btn.disabled = true;
      try { v.src = await otURL(src, (got, total) => { btn.textContent = `${T().vidDl}${fmtMB(got)} / ${fmtMB(total)}`; }); btn.remove(); v.play().catch(() => {}); }
      catch (e) { btn.textContent = T().fail + e.message; }
    };
  });
}

const prog = (el) => (got, total) => { el.textContent = total ? `${T().v.dl}${fmtMB(got)} / ${fmtMB(total)}` : `${T().v.dl}${fmtMB(got)}`; };

// ---------------------------------------------------------------- scene viewer (page "viewer")
function sceneViewer() {
  const box = $('scene-viewer'), status = $('s-status'), S = T().v;
  let V = null, cloudName = null, meshBlobs = {}, poses = null;
  const CUT = () => +$('s-cut').value;

  async function loadMesh(name) {
    if (!meshBlobs[name]) { status.textContent = S.mesh; meshBlobs[name] = await loadBlob(`assets/3d/${name}.bin`, prog(status)); }
    V.remove('mesh');
    const m = V.addMesh('mesh', meshBlobs[name], { opacity: +$('s-op').value });
    if ($('s-uniform').checked) V.setMeshUniform(m, '#8fb3a9');
    m.visible = $('s-mesh').checked; applyIsolate(); return meshBlobs[name];
  }
  async function loadCloud(name) {
    status.textContent = S.pts;
    const b = await loadBlob(`assets/3d/${name}.bin`, prog(status));
    V.remove('pts');
    const p = V.addPoints('pts', b, { size: +$('s-sz').value, maxY: CUT() });
    p.visible = $('s-pts').checked; cloudName = name; applyPeel();
    status.textContent = (name === 'cloud_hi' ? S.hi : S.lo) + S.pts2;
  }
  function applyPeel() {
    const cid = +$('s-cid').value, p = V.objects.pts;
    if (p) { p.material.uniforms.uHide.value = $('s-isolate').checked ? 0 : cid; p.material.uniforms.uHighlight.value = 0; }
    applyIsolate(); V.redraw();
  }
  function applyIsolate() {
    const m = V.objects.mesh; if (!m) return;
    const cid = +$('s-cid').value;
    V.isolateMesh(m, $('s-isolate').checked && cid ? cid : 0);
    const p = V.objects.pts; if (p && $('s-isolate').checked && cid) p.material.uniforms.uHide.value = 0;
  }
  // ---- camera frustums
  function updateFrustums() {
    if (!poses) return;
    V.remove('frusta'); V.remove('frustaKf'); V.remove('frustaSel');
    if ($('s-frusta').checked) { const kf = new Set(Object.keys(poses.hdr.keyframes).map(Number)); const idx = []; for (let i = 0; i < poses.hdr.n; i++) if (i % 10 === 0 && !kf.has(i)) idx.push(i); V.addFrustums('frusta', poses, { indices: idx, depth: 0.22, color: 0x3b6fd6, opacity: 0.5 }); }
    if ($('s-frustakf').checked) V.addFrustums('frustaKf', poses, { indices: Object.keys(poses.hdr.keyframes).map(Number), depth: 0.5, color: 0xff8c00, opacity: 1 });
    if ($('s-camsel').checked) V.addFrustums('frustaSel', poses, { indices: [+$('s-cam').value], depth: 0.7, color: 0xd62828, opacity: 1 });
    camInfo();
  }
  function camInfo() {
    const i = +$('s-cam').value, kf = poses && poses.hdr.keyframes[i];
    $('s-camv').textContent = i; $('s-caminfo').textContent = kf ? `${S.kf}${kf}` : S.notkf;
  }
  async function init() {
    $('s-load').remove();
    V = createViewer(box); viewers.push(V);
    try {
      const blob = await loadMesh($('s-meshsel').value);
      const cent = blob.hdr.centroid_by_cid || {}, sel = $('s-cid');
      Object.keys(cent).map(Number).sort((a, b) => a - b).forEach((k) => { const o = document.createElement('option'); o.value = k; o.textContent = `${S.cub}${k}${k === 14 ? S.L : ''}`; sel.appendChild(o); });
      V.addGrid(40, 0); V.objects.grid.visible = $('s-grid').checked;
      V.frame(blob.hdr.bbox, { dir: [0.5, 0.9, 0.7], dist: 1.0 });
      const traj = await loadBlob('assets/3d/trajectory.bin');
      V.addLine('traj', traj, 0xff8c00).visible = $('s-traj').checked;
      poses = await loadBlob('assets/3d/poses.bin');
      $('s-cam').max = poses.hdr.n - 1; updateFrustums();
      await loadCloud('cloud_lo');
    } catch (e) { status.textContent = T().fail + e.message; console.error(e); }
  }
  $('s-load').querySelector('button').onclick = init;
  $('s-mesh').onchange = (e) => V && V.setVisible('mesh', e.target.checked);
  $('s-pts').onchange = (e) => V && V.setVisible('pts', e.target.checked);
  $('s-traj').onchange = (e) => V && V.setVisible('traj', e.target.checked);
  $('s-grid').onchange = (e) => V && V.setVisible('grid', e.target.checked);
  $('s-frusta').onchange = $('s-frustakf').onchange = $('s-camsel').onchange = () => V && updateFrustums();
  $('s-cam').oninput = () => { if (!V) return; camInfo(); if ($('s-camsel').checked) updateFrustums(); };
  $('s-camview').onclick = () => { if (V && poses) { $('s-camsel').checked = true; updateFrustums(); V.lookFromPose(poses, +$('s-cam').value); } };
  $('s-camprev').onclick = () => { $('s-cam').value = Math.max(0, +$('s-cam').value - 1); $('s-cam').oninput(); };
  $('s-camnext').onclick = () => { $('s-cam').value = Math.min(+$('s-cam').max, +$('s-cam').value + 1); $('s-cam').oninput(); };
  $('s-meshsel').onchange = () => V && loadMesh($('s-meshsel').value);
  $('s-uniform').onchange = (e) => { const m = V && V.objects.mesh; if (m) V.setMeshUniform(m, e.target.checked ? '#8fb3a9' : null); };
  $('s-op').oninput = (e) => { const m = V && V.objects.mesh; if (m) { m.material.opacity = +e.target.value; m.material.depthWrite = +e.target.value > 0.99; V.redraw(); } };
  $('s-sz').oninput = (e) => { const p = V && V.objects.pts; if (p) { p.material.uniforms.uSize.value = +e.target.value; V.redraw(); } };
  $('s-cut').oninput = (e) => { $('s-cuty').textContent = e.target.value; const p = V && V.objects.pts; if (p) { p.material.uniforms.uMaxY.value = +e.target.value; V.redraw(); } };
  $('s-hi').onclick = async () => { if (!V || cloudName === 'cloud_hi') return; $('s-hi').disabled = true; await loadCloud('cloud_hi'); $('s-hi').textContent = S.hiDone; };
  $('s-cid').onchange = () => V && (applyPeel(), focusCid());
  $('s-isolate').onchange = () => V && applyPeel();
  function focusCid() {
    const cid = +$('s-cid').value, m = V.objects.mesh; if (!cid || !m) return;
    const c = m.userData.blob.hdr.centroid_by_cid?.[cid]; if (!c) return;
    V.restoreFov();
    const t = new V.THREE.Vector3(c[0], 0.6, c[2]), dir = new V.THREE.Vector3(0.6, 0.7, 0.6).normalize();
    V.camera.position.copy(t).addScaledVector(dir, 5.5); V.controls.target.copy(t); V.controls.update(); V.redraw();
  }
  $('s-reset').onclick = () => { const m = V && V.objects.mesh; if (m) V.frame(m.userData.blob.hdr.bbox, { dir: [0.5, 0.9, 0.7], dist: 1.0 }); };
  $('s-top').onclick = () => { const m = V && V.objects.mesh; if (m) V.frame(m.userData.blob.hdr.bbox, { dir: [0.001, 1, 0.001], dist: 1.1 }); };
  $('s-fs').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : box.requestFullscreen());
}

// ---------------------------------------------------------------- canonical viewer (page "p3")
function canonViewer() {
  const box = $('canon-viewer'), status = $('c-status'), S = T().v;
  let V = null; const cache = {};
  async function showType(t) {
    if (!cache[t]) { status.textContent = T().loading; cache[t] = { m: await loadBlob(`assets/3d/template_${t}.bin`), p: await loadBlob(`assets/3d/canonical_${t}.bin`, prog(status)) }; }
    V.remove('mesh'); V.remove('pts');
    const m = V.addMesh('mesh', cache[t].m, { opacity: +$('c-op').value, uniform: t === 'U' ? '#5b8def' : '#e08a3c' });
    m.material.depthWrite = +$('c-op').value > 0.99; m.visible = $('c-mesh').checked;
    const p = V.addPoints('pts', cache[t].p, { size: +$('c-sz').value }); p.visible = $('c-pts').checked;
    V.frame(cache[t].p.hdr.bbox, { dir: [0.9, 0.6, 0.9], dist: 1.4 });
    status.textContent = S.cstat(t, cache[t].p.hdr.n.toLocaleString(), cache[t].m.hdr.m.toLocaleString());
  }
  $('c-load').querySelector('button').onclick = async () => {
    $('c-load').remove(); V = createViewer(box); viewers.push(V); V.addGrid(6, 0);
    try { await showType('U'); } catch (e) { status.textContent = T().fail + e.message; }
  };
  document.querySelectorAll('input[name=ctype]').forEach((r) => (r.onchange = () => V && showType(r.value)));
  $('c-mesh').onchange = (e) => V && V.setVisible('mesh', e.target.checked);
  $('c-pts').onchange = (e) => V && V.setVisible('pts', e.target.checked);
  $('c-op').oninput = (e) => { const m = V && V.objects.mesh; if (m) { m.material.opacity = +e.target.value; m.material.depthWrite = +e.target.value > 0.99; V.redraw(); } };
  $('c-sz').oninput = (e) => { const p = V && V.objects.pts; if (p) { p.material.uniforms.uSize.value = +e.target.value; V.redraw(); } };
  $('c-reset').onclick = () => { const p = V && V.objects.pts; if (p) V.frame(p.userData.blob.hdr.bbox, { dir: [0.9, 0.6, 0.9], dist: 1.4 }); };
  $('c-fs').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : box.requestFullscreen());
}
