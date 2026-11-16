'use strict';
/* =====================================================================================
   App state, the 3D scene (meshes + 2D overlay), camera interaction and picking.
   ===================================================================================== */
const $ = s => document.querySelector(s);
const HWATER = 0.62;                                   // scene height of the water column
const SEL = ['#3987e5', '#d95926', '#199e70'];         // up to three compared stations
const INK = '#eef1f4', INK2 = '#b4bdc8', INK3 = '#7d8794', BG = '#081420';
const GREY = [128, 136, 147];                          // extended (not measured) sections
const DEPTH_TICKS = [0, 10, 25, 50, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 4000, 5000, 6000, 8000, 10000];

const S = {
  entries: [], cur: null, ds: null, k: 1,
  show: {}, floorColor: 'depth', vars: {physics: 'temperature_c', chemistry: 'oxygen_umol_kg'},
  surf: {physics: {on: false, value: 20}, chemistry: {on: false, value: 100}}, surfInfo: {},
  win: 1000, vscale: 'sqrt', track: true, labels: false, zoom: 1,
  sel: [null, null, null], selOrder: [], bioFocus: null, story: -1, hover: null, hoverDepth: null, picks: [], cols: [], curPts: [],
};
let R = null, ovCtx = null, dpr = 1, drawQueued = false;

const RAMP = {
  depth: makeRamp([[0, '#d3e5fb'], [0.1, '#9ec5f4'], [0.28, '#5598e7'], [0.5, '#256abf'], [0.75, '#104281'], [1, '#0b2c5a']]),
  land: makeRamp([[0, '#6f6a59'], [1, '#cfc8ad']]),
  slope: makeRamp([[0, '#0f2f5c'], [0.45, '#3987e5'], [1, '#eaf2fd']]),
  speed: makeRamp([[0, '#5d6672'], [0.5, '#c9c2ad'], [1, '#fff8e3']]), bio: hueRamp('#d55181'),
};
for (const v of VAR_KEYS) RAMP[v] = hueRamp(VARS[v].hue);
const rampCss = (ramp, n = 9) => `linear-gradient(90deg, ${Array.from({length: n}, (_, i) => rgbCss(ramp(i / (n - 1)))).join(',')})`;

/* ---------- world -> scene --------------------------------------------------------- */
const sx = xkm => xkm * S.k, sz = ykm => -ykm * S.k;
function sy(depth) {                                   // depth in metres, positive down; negative = land
  if (depth < 0) { const f = -depth / S.ds.maxDepth; return HWATER * 0.3 * (S.vscale === 'sqrt' ? Math.sqrt(f) : f * 3); }
  const f = depth / S.win; return -HWATER * (S.vscale === 'sqrt' ? Math.sqrt(f) : f);
}
function varRange(v) {
  let lo = Infinity, hi = -Infinity;
  for (const s of S.ds.casts) { const a = s.prof.vars[v]; if (!a) continue; const d = s.prof.depth, f = s.prof.flag;
    for (let i = 0; i < a.length; i++) { if (d[i] > S.win) break; const x = a[i]; if (Number.isNaN(x) || f[i] === 1) continue; if (x < lo) lo = x; if (x > hi) hi = x; } }
  if (!(lo < Infinity)) return [0, 1];
  if (hi - lo < 1e-9) { lo -= 0.5; hi += 0.5; }
  return [lo, hi];
}
const visibleSlot = id => S.show[id] && S.ds.slots[id].has;

/* ---------- meshes ----------------------------------------------------------------- */
function buildFloor() {
  if (!R) return; if (!visibleSlot('seafloor')) { R.removeMesh('floor'); return; }
  const ds = S.ds, g = ds.grid, st = Math.max(1, Math.ceil(Math.max(g.ncols, g.nrows) / 240));
  const nx = Math.floor((g.ncols - 1) / st) + 1, ny = Math.floor((g.nrows - 1) / st) + 1, n = nx * ny;
  const pos = new Float32Array(n * 3), col = new Uint8Array(n * 4), nor = new Float32Array(n * 3), el = new Float32Array(n);
  const cd = Math.min(S.win, ds.maxDepth), mx = 111320 * Math.cos(ds.latC * Math.PI / 180) * g.dx * st, my = 110570 * g.dy * st;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const p = j * nx + i, e = g.data[(j * st) * g.ncols + i * st]; el[p] = e;
    pos[p * 3] = sx(ds.X(g.lon0 + i * st * g.dx)); pos[p * 3 + 1] = Number.isNaN(e) ? 0 : sy(-e); pos[p * 3 + 2] = sz(ds.Y(g.lat0 + j * st * g.dy));
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const p = j * nx + i, e = el[p], i0 = Math.max(0, i - 1), i1 = Math.min(nx - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(ny - 1, j + 1);
    const a = j * nx + i0, b = j * nx + i1, c = j0 * nx + i, d = j1 * nx + i;
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], vy = pos[d * 3 + 1] - pos[c * 3 + 1], vz = pos[d * 3 + 2] - pos[c * 3 + 2];
    let nx_ = uy * vz, ny_ = -ux * vz, nz_ = ux * vy;                             // cross((ux,uy,0),(0,vy,vz)), made to point up
    if (ny_ < 0) { nx_ = -nx_; ny_ = -ny_; nz_ = -nz_; }
    const l = Math.hypot(nx_, ny_, nz_) || 1; nor[p * 3] = nx_ / l; nor[p * 3 + 1] = ny_ / l; nor[p * 3 + 2] = nz_ / l;
    let rgb;
    if (S.floorColor === 'slope') { const sl = Math.atan(Math.hypot((el[b] - el[a]) / ((i1 - i0) * mx), (el[d] - el[c]) / ((j1 - j0) * my))) * 180 / Math.PI; rgb = RAMP.slope(sl / 30); }
    else rgb = e >= 0 ? RAMP.land(e / Math.max(50, g.max)) : RAMP.depth(Math.pow(Math.min(1, -e / cd), 0.6));
    col[p * 4] = rgb[0]; col[p * 4 + 1] = rgb[1]; col[p * 4 + 2] = rgb[2]; col[p * 4 + 3] = 255;
  }
  const idx = new Uint16Array((nx - 1) * (ny - 1) * 6); let q = 0;
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    if (Number.isNaN(el[a]) || Number.isNaN(el[b]) || Number.isNaN(el[c]) || Number.isNaN(el[d])) continue;
    idx[q++] = a; idx[q++] = b; idx[q++] = c; idx[q++] = b; idx[q++] = d; idx[q++] = c;
  }
  R.setMesh('floor', {pos, col, nor, idx: idx.subarray(0, q), lit: true});
}

function buildColumns() {
  S.cols = [];
  const both = visibleSlot('physics') && visibleSlot('chemistry');
  for (const slot of ['physics', 'chemistry']) {
    const name = 'col-' + slot; if (!visibleSlot(slot)) { if (R) R.removeMesh(name); continue; }
    const v = S.vars[slot], [lo, hi] = varRange(v), ramp = RAMP[v], off = both ? (slot === 'physics' ? -0.011 : 0.011) : 0;
    const P = [], C = [], I = []; let nv = 0;
    for (const s of S.ds.casts) {
      const a = s.prof.vars[v]; if (!a) continue; const d = s.prof.depth, f = s.prof.flag, w = S.sel.includes(s.id) ? 0.0115 : 0.0072;
      const x = sx(s.x) + off, z = sz(s.y); let prev = -1; const lv = [];
      for (let i = 0; i < a.length; i++) {
        if (Number.isNaN(a[i])) continue; if (d[i] > S.win * 1.05 && prev >= 0) break;
        const y = sy(d[i]), c = f[i] === 1 ? GREY : ramp((a[i] - lo) / (hi - lo));
        P.push(x - w, y, z - w, x + w, y, z - w, x + w, y, z + w, x - w, y, z + w);
        for (let k = 0; k < 4; k++) C.push(c[0], c[1], c[2], 255);
        if (prev >= 0) for (let k = 0; k < 4; k++) { const k2 = (k + 1) % 4; I.push(prev + k, prev + k2, nv + k2, prev + k, nv + k2, nv + k); }
        prev = nv; nv += 4; lv.push(i);
      }
      if (lv.length) S.cols.push({s, slot, v, x, z, lv});
    }
    if (R) R.setMesh(name, {pos: new Float32Array(P), col: new Uint8Array(C), idx: nv > 65535 ? new Uint32Array(I) : new Uint16Array(I)});
  }
}

function buildSurfaces() {
  for (const slot of ['physics', 'chemistry']) {
    const name = 'surf-' + slot, cfg = S.surf[slot]; S.surfInfo[slot] = null;
    if (!visibleSlot(slot) || !cfg.on) { if (R) R.removeMesh(name); continue; }
    const v = S.vars[slot], pts = [];
    for (const s of S.ds.casts) { const a = s.prof.vars[v]; if (!a) continue; const d = crossDepth(s.prof.depth, a, cfg.value, s.prof.flag); if (!Number.isNaN(d)) pts.push({s, x: s.x, y: s.y, d}); }
    const info = S.surfInfo[slot] = {v, value: cfg.value, n: pts.length, pts, min: Math.min(...pts.map(p => p.d)), max: Math.max(...pts.map(p => p.d))};
    if (pts.length < 3) { if (R) R.removeMesh(name); continue; }
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, nnMax = 0;
    for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
      let nn = Infinity; for (const q of pts) if (q !== p) nn = Math.min(nn, Math.hypot(p.x - q.x, p.y - q.y)); nnMax = Math.max(nnMax, nn); }
    const rad = Math.max(nnMax * 0.75, Math.hypot(x1 - x0, y1 - y0) * 0.06), pad = rad * 0.9; x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
    const N = 60, pos = new Float32Array(N * N * 3), col = new Uint8Array(N * N * 4), ok = new Uint8Array(N * N);
    const h = hex2rgb(VARS[v].hue), light = mix(h, [255, 255, 255], 0.55), dark = mix(h, [10, 14, 20], 0.35), span = (info.max - info.min) || 1;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = x0 + (x1 - x0) * i / (N - 1), y = y0 + (y1 - y0) * j / (N - 1); let sw = 0, sd = 0, near = Infinity;
      for (const p of pts) { const r = Math.hypot(x - p.x, y - p.y); near = Math.min(near, r); const w = 1 / (r * r + 0.01 * rad * rad); sw += w; sd += w * p.d; }
      const d = sd / sw, p = j * N + i, c = mix(light, dark, (d - info.min) / span), fade = Math.max(0, Math.min(1, (rad - near) / (rad * 0.3))); ok[p] = near <= rad ? 1 : 0;
      pos[p * 3] = sx(x); pos[p * 3 + 1] = sy(d); pos[p * 3 + 2] = sz(y); col[p * 4] = c[0]; col[p * 4 + 1] = c[1]; col[p * 4 + 2] = c[2]; col[p * 4 + 3] = 165 * fade;
    }
    const idx = []; for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) { const a = j * N + i, b = a + 1, c = a + N, d = c + 1; if (ok[a] && ok[b] && ok[c] && ok[d]) idx.push(a, b, c, b, d, c); }
    if (R) R.setMesh(name, {pos, col, idx: new Uint16Array(idx), blend: true, order: slot === 'physics' ? 1 : 2});
  }
}

function buildCurrents() {
  S.curPts = []; S.curMax = 0; if (!visibleSlot('currents')) { if (R) R.removeMesh('cur'); return; }
  let list = S.ds.currents.filter(c => c.depth <= S.win && c.speed > 0); const stride = Math.ceil(list.length / 4000); if (stride > 1) list = list.filter((_, i) => i % stride === 0);
  const vmax = list.reduce((m, c) => Math.max(m, c.speed), 0) || 1; S.curMax = vmax;
  const P = new Float32Array(list.length * 18), C = new Uint8Array(list.length * 24), I = new (list.length * 6 > 65535 ? Uint32Array : Uint16Array)(list.length * 6);
  list.forEach((c, n) => {
    const L = Math.max(0.014, c.speed / vmax * 0.105), dx = c.u / c.speed, dz = -c.v / c.speed, hw = Math.max(0.0045, L * 0.16);
    const x = sx(c.x), y = sy(c.depth), z = sz(c.y), tx = x - dx * L / 2, tz = z - dz * L / 2, hx = x + dx * L / 2, hz = z + dz * L / 2, col = RAMP.speed(c.speed / vmax), o = n * 18;
    P.set([tx - dz * hw, y, tz + dx * hw, tx + dz * hw, y, tz - dx * hw, hx, y, hz, tx, y + hw, tz, tx, y - hw, tz, hx, y, hz], o);
    for (let k = 0; k < 6; k++) C.set([col[0], col[1], col[2], 255], n * 24 + k * 4);
    for (let k = 0; k < 6; k++) I[n * 6 + k] = n * 6 + k;
    S.curPts.push({c, x, y, z});
  });
  if (R) R.setMesh('cur', {pos: P, col: C, idx: I});
}
function rebuildScene() { buildFloor(); buildColumns(); buildSurfaces(); buildCurrents(); requestDraw(); }

/* ---------- 2D overlay: frame, track, markers, labels ------------------------------ */
const SHAPE = {ctd: 'circle', rov: 'diamond', dive: 'diamond', xbt: 'triangle', edna: 'star', water: 'square', net: 'tridown', camera: 'cross', model: 'dot'};
const shapeOf = type => SHAPE[String(type).toLowerCase()] || 'ring';
function marker(ctx, shape, x, y, r, fill, stroke, lw = 1.2) {
  ctx.beginPath();
  if (shape === 'circle' || shape === 'ring' || shape === 'dot') ctx.arc(x, y, shape === 'dot' ? r * 0.55 : r, 0, 6.2832);
  else if (shape === 'diamond') { ctx.moveTo(x, y - r * 1.25); ctx.lineTo(x + r * 1.05, y); ctx.lineTo(x, y + r * 1.25); ctx.lineTo(x - r * 1.05, y); ctx.closePath(); }
  else if (shape === 'triangle') { ctx.moveTo(x, y - r * 1.2); ctx.lineTo(x + r * 1.15, y + r * 0.9); ctx.lineTo(x - r * 1.15, y + r * 0.9); ctx.closePath(); }
  else if (shape === 'tridown') { ctx.moveTo(x, y + r * 1.2); ctx.lineTo(x + r * 1.15, y - r * 0.9); ctx.lineTo(x - r * 1.15, y - r * 0.9); ctx.closePath(); }
  else if (shape === 'square') ctx.rect(x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8);
  else if (shape === 'star') { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? r * 0.62 : r * 1.45; ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * q, y + Math.sin(a) * q); } ctx.closePath(); }
  else if (shape === 'cross') { ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); }
  if (shape === 'ring' || shape === 'cross') { ctx.strokeStyle = fill; ctx.lineWidth = 1.6; ctx.stroke(); return; }
  ctx.fillStyle = fill; ctx.fill(); if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
function label(ctx, text, x, y, color = INK, align = 'left') {
  ctx.textAlign = align; ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(8,20,32,.88)'; ctx.lineJoin = 'round'; ctx.strokeText(text, x, y); ctx.fillStyle = color; ctx.fillText(text, x, y);
}
function niceStep(range, target) { const raw = range / target, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p; }

function drawOverlay() {
  const ctx = ovCtx, ds = S.ds; if (!ctx || !ds || !R) return; const [W, Hh] = R.size;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, Hh); ctx.font = '11px "IBM Plex Sans", system-ui, sans-serif'; ctx.textBaseline = 'middle';
  const ax = ds.halfX * S.k, az = ds.halfY * S.k, P = (x, y, z) => R.project(x, y, z);
  const line = (a, b, style, lw = 1, dash) => { if (!a[2] || !b[2]) return; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.strokeStyle = style; ctx.lineWidth = lw; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]); };
  // frame: sea surface, window floor, verticals
  const cs = [[-ax, az], [ax, az], [ax, -az], [-ax, -az]];
  for (let i = 0; i < 4; i++) { const a = cs[i], b = cs[(i + 1) % 4];
    line(P(a[0], 0, a[1]), P(b[0], 0, b[1]), 'rgba(226,232,240,.42)', 1); line(P(a[0], -HWATER, a[1]), P(b[0], -HWATER, b[1]), 'rgba(226,232,240,.14)', 1); line(P(a[0], 0, a[1]), P(a[0], -HWATER, a[1]), 'rgba(226,232,240,.14)', 1); }
  // depth ticks on the left-most vertical edge; lon and lat ticks on the two surface edges that do not touch it
  const edge = cs.map(c => ({c, p: P(c[0], 0, c[1])})).filter(e => e.p[2]).sort((a, b) => a.p[0] - b.p[0])[0];
  if (edge) { let lastY = -99;
    for (const d of DEPTH_TICKS) { if (d > S.win) break; const p = P(edge.c[0], sy(d), edge.c[1]); if (!p[2] || p[1] - lastY < 14) continue; lastY = p[1];
      line(p, [p[0] - 5, p[1], true], 'rgba(226,232,240,.5)'); label(ctx, d === 0 ? '0 m' : fmtInt(d), p[0] - 8, p[1], INK3, 'right'); }
    const g = ds.grid, centre = P(0, 0, 0), front = cs.map(c => ({c, p: P(c[0], 0, c[1])})).filter(e => e.p[2]).sort((a, b) => b.p[1] - a.p[1])[0], zEdge = front.c[1], xEdge = front.c[0];
    const foot = P(edge.c[0], -HWATER, edge.c[1]), inBand = pt => pt[0] < edge.p[0] + 62 && pt[1] > edge.p[1] - 14 && pt[1] < (foot[2] ? foot[1] : edge.p[1]) + 14;
    const tick = (pt, text, clear) => { if (!pt[2] || !centre[2] || inBand(pt) || (clear && Math.hypot(pt[0] - front.p[0], pt[1] - front.p[1]) < 34)) return;
      let dx = pt[0] - centre[0], dy = pt[1] - centre[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l; line(pt, [pt[0] + dx * 5, pt[1] + dy * 5, true], 'rgba(226,232,240,.5)'); label(ctx, text, pt[0] + dx * 10, pt[1] + dy * 10 + 1, INK3, dx > 0.35 ? 'left' : dx < -0.35 ? 'right' : 'center'); };
    const deg = (f, v, step) => f(Math.abs(v) < step / 1000 ? 0 : v).replace(/\d+\.\d+/, m => (+m).toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0));
    const stepLon = niceStep(g.lon1 - g.lon0, 4); for (let v = Math.ceil(g.lon0 / stepLon - 1e-6) * stepLon; v <= g.lon1 + 1e-9; v += stepLon) tick(P(sx(ds.X(v)), 0, zEdge), deg(fmtLon, v, stepLon), false);
    const stepLat = niceStep(g.lat1 - g.lat0, 4); for (let v = Math.ceil(g.lat0 / stepLat - 1e-6) * stepLat; v <= g.lat1 + 1e-9; v += stepLat) tick(P(xEdge, 0, sz(ds.Y(v))), deg(fmtLat, v, stepLat), true);
  }
  const picks = S.picks = [];
  // ship track
  if (visibleSlot('stations') && S.track && ds.track.length > 1) { ctx.beginPath(); let pen = false; for (const t of ds.track) { const p = P(sx(t.x), 0, sz(t.y)); if (!p[2]) { pen = false; continue; } ctx[pen ? 'lineTo' : 'moveTo'](p[0], p[1]); pen = true; } ctx.strokeStyle = 'rgba(239,230,207,.5)'; ctx.lineWidth = 1.2; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]); }
  // where each cast meets an interpolated surface
  for (const slot of ['physics', 'chemistry']) { const info = S.surfInfo[slot]; if (!info || !visibleSlot(slot)) continue; for (const q of info.pts) { if (q.d > S.win) continue; const p = P(sx(q.x), sy(q.d), sz(q.y)); if (!p[2]) continue; marker(ctx, 'circle', p[0], p[1], 3, '#fff', rgbCss(hex2rgb(VARS[info.v].hue)), 1.5); picks.push({x: p[0], y: p[1], r: 5, kind: 'cross', ref: q, info}); } }
  // biology samples
  if (visibleSlot('biology')) { const rmax = Math.max(...ds.samples.map(b => b.richness), 1), hmax = Math.max(...ds.samples.map(b => b.shannon || 0), 0.001);
    for (const b of ds.samples) { if (b.depth > S.win) continue; const p = P(sx(b.x), sy(b.depth), sz(b.y)), top = P(sx(b.x), 0, sz(b.y)); if (!p[2]) continue; line(top, p, 'rgba(213,81,129,.55)', 1);
      const r = 4 + 9 * Math.sqrt(b.richness / rmax), c = RAMP.bio(Number.isNaN(b.shannon) ? 0.5 : 0.2 + 0.8 * b.shannon / hmax);
      marker(ctx, 'circle', p[0], p[1], r, rgbCss(c), S.bioFocus === b ? '#fff' : 'rgba(10,14,19,.9)', S.bioFocus === b ? 2 : 1.2); picks.push({x: p[0], y: p[1], r, kind: 'bio', ref: b}); } }
  // stations
  if (visibleSlot('stations')) for (const s of ds.stations) {
    const p = P(sx(s.x), 0, sz(s.y)); if (!p[2]) continue; const si = S.sel.indexOf(s.id), hov = S.hover && S.hover.kind === 'station' && S.hover.ref === s;
    if (si >= 0) { const fl = Number.isNaN(s.floor) ? S.win : Math.min(Math.max(s.floor, 0), S.win), q = P(sx(s.x), sy(fl), sz(s.y)); line(p, q, SEL[si], 1, [2, 3]); }
    marker(ctx, shapeOf(s.type), p[0], p[1], si >= 0 ? 6 : 4.4, si >= 0 ? SEL[si] : '#efe6cf', 'rgba(10,14,19,.95)');
    if (si >= 0) { ctx.beginPath(); ctx.arc(p[0], p[1], 10.5, 0, 6.2832); ctx.strokeStyle = SEL[si]; ctx.lineWidth = 1.6; ctx.stroke(); }
    if (si >= 0 || hov || S.labels) label(ctx, s.id, p[0] + 13, p[1] - 9, si >= 0 || hov ? INK : INK2);
    picks.push({x: p[0], y: p[1], r: 8, kind: 'station', ref: s});
  }
  const north = P(0, 0, -az), c0 = P(0, 0, 0); if (north[2] && c0[2]) { const dx = north[0] - c0[0], dy = north[1] - c0[1], l = Math.hypot(dx, dy) || 1; label(ctx, 'N', north[0] + dx / l * 14, north[1] + dy / l * 14, INK2, 'center'); }
}
const clampZoom = z => Math.max(0.4, Math.min(12, z));
function requestDraw() { if (drawQueued) return; drawQueued = true; requestAnimationFrame(() => { drawQueued = false; if (!R) return; const [w, h] = R.size; R.cam.dist = 4.05 * Math.max(1, 1.5 / (w / h)) / S.zoom; R.draw(-HWATER - 0.0015); drawOverlay(); }); }

/* ---------- picking and tooltip ---------------------------------------------------- */
function pickAt(mx, my) {
  let best = null, bd = Infinity;
  for (const p of S.picks) { const d = Math.hypot(p.x - mx, p.y - my); if (d <= p.r + 4 && d - p.r < bd) { bd = d - p.r; best = p; } }
  if (best) return best; bd = 9;
  for (const c of S.cols) { const d = c.s.prof.depth, st = Math.max(1, Math.ceil(c.lv.length / 250));
    for (let k = 0; k < c.lv.length; k += st) { const i = c.lv[k]; if (d[i] > S.win) break; const p = R.project(c.x, sy(d[i]), c.z); if (!p[2]) continue; const q = Math.hypot(p[0] - mx, p[1] - my); if (q < bd) { bd = q; best = {x: p[0], y: p[1], kind: 'prof', ref: c.s, i, v: c.v}; } } }
  if (best) return best;
  for (const c of S.curPts) { const p = R.project(c.x, c.y, c.z); if (!p[2]) continue; const q = Math.hypot(p[0] - mx, p[1] - my); if (q < bd) { bd = q; best = {x: p[0], y: p[1], kind: 'cur', ref: c.c}; } }
  return best;
}
function tipHtml(h) {
  if (h.kind === 'station') { const s = h.ref; return `<b>${esc(s.id)}</b> <span class="t-dim">${esc(s.type)}</span><br>${fmtTime(s.time)} UTC<br>${fmtLat(s.lat)} ${fmtLon(s.lon)}${s.label ? `<br><span class="t-dim">${esc(s.label.length > 110 ? s.label.slice(0, 108) + '…' : s.label)}</span>` : ''}<br><span class="t-hint">Click to select</span>`; }
  if (h.kind === 'prof') { const s = h.ref, p = s.prof, i = h.i; const rows = VAR_KEYS.filter(v => p.vars[v] && !Number.isNaN(p.vars[v][i])).map(v => `<span class="sw" style="background:${VARS[v].hue}"></span>${VARS[v].label} <b>${fmt(p.vars[v][i], VARS[v].dec)}</b> ${VARS[v].unit}`).join('<br>');
    return `<b>${esc(s.id)}</b> at <b>${fmtInt(p.depth[i])} m</b><br>${rows}${p.flag[i] ? `<br><span class="t-dim">${FLAGS[p.flag[i]]}, not measured here</span>` : ''}`; }
  if (h.kind === 'cur') { const c = h.ref, dir = (Math.atan2(c.u, c.v) * 180 / Math.PI + 360) % 360; return `<b>${fmt(c.speed, 2)} m/s</b> toward ${compass(dir)} (${fmtInt(dir)}°)<br>at ${fmtInt(c.depth)} m`; }
  if (h.kind === 'bio') { const b = h.ref; return `<b>${esc(b.id)}</b> <span class="t-dim">${esc(b.method || 'sample')}</span><br>${plural(b.richness, 'taxon', 'taxa')}${Number.isNaN(b.shannon) ? '' : `, diversity H′ ${fmt(b.shannon, 2)}`}<br>at ${fmtInt(b.depth)} m<br><span class="t-dim">Top: ${b.taxa.slice(0, 3).map(t => esc(t.name)).join(', ')}</span><br><span class="t-hint">Click to open</span>`; }
  if (h.kind === 'cross') { const q = h.ref, v = VARS[h.info.v]; return `<b>${esc(q.s.id)}</b><br>${v.label} reaches ${+h.info.value.toFixed(3)} ${v.unit} at <b>${fmtInt(q.d)} m</b>`; }
  return '';
}
function showTip(h, mx, my) {
  const tip = $('#tip'); if (!h) { tip.style.display = 'none'; return; }
  tip.innerHTML = tipHtml(h); tip.style.display = 'block'; const [W, Hh] = R.size, w = tip.offsetWidth, hh = tip.offsetHeight;
  tip.style.left = Math.max(4, Math.min(W - w - 4, mx + 14)) + 'px'; tip.style.top = Math.max(4, Math.min(Hh - hh - 4, my + 14)) + 'px';
}

/* ---------- camera interaction ------------------------------------------------------ */
function resetCamera(c) {
  const cam = R.cam, ds = S.ds; cam.az = ((c && c.az) ?? -28) * Math.PI / 180; cam.el = ((c && c.el) ?? 30) * Math.PI / 180; S.zoom = (c && c.zoom) || 1; cam.tx = 0; cam.tz = 0; cam.ty = -HWATER * 0.5;
  if (c && Array.isArray(c.focus)) { cam.tx = sx(ds.X(c.focus[0])); cam.tz = sz(ds.Y(c.focus[1])); }
}
function initScene() {
  const wrap = $('#scene-wrap'), glc = $('#gl'), ov = $('#ov');
  try { R = createRenderer(glc); } catch (e) { R = null; }
  if (!R) { $('#nogl').hidden = false; glc.style.display = 'none'; ov.style.display = 'none'; return; }
  R.setBg([8 / 255, 20 / 255, 32 / 255]); ovCtx = ov.getContext('2d');
  const fit = () => { const r = wrap.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1); R.resize(r.width, r.height, dpr); ov.width = Math.round(r.width * dpr); ov.height = Math.round(r.height * dpr); requestDraw(); };
  new ResizeObserver(fit).observe(wrap); fit();
  const ptrs = new Map(); let moved = 0, pinch = 0, mode = 'rot';
  const xy = e => { const r = ov.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  ov.addEventListener('pointerdown', e => { ov.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, xy(e)); moved = 0; mode = (e.button === 2 || e.shiftKey || e.ctrlKey || e.metaKey) ? 'pan' : 'rot';
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); } showTip(null); });
  ov.addEventListener('pointermove', e => {
    const p = xy(e), last = ptrs.get(e.pointerId);
    if (!last) { const h = pickAt(p[0], p[1]); const ch = (h && h.ref) !== (S.hover && S.hover.ref) || (h && h.i) !== (S.hover && S.hover.i); S.hover = h; ov.style.cursor = h && (h.kind === 'station' || h.kind === 'bio' || h.kind === 'prof') ? 'pointer' : 'grab'; showTip(h, p[0], p[1]); if (ch) requestDraw(); return; }
    const dx = p[0] - last[0], dy = p[1] - last[1]; moved += Math.abs(dx) + Math.abs(dy); ptrs.set(e.pointerId, p); const cam = R.cam;
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch > 0) S.zoom = clampZoom(S.zoom * d / pinch); pinch = d; R.pan(dx / 2, dy / 2); }
    else if (mode === 'pan') R.pan(dx, dy);
    else { cam.az -= dx * 0.0085; cam.el = Math.max(-0.12, Math.min(1.5, cam.el + dy * 0.0085)); }
    requestDraw();
  });
  const up = e => { const had = ptrs.has(e.pointerId); ptrs.delete(e.pointerId); pinch = 0; if (had && moved < 5 && ptrs.size === 0) { const p = xy(e), h = pickAt(p[0], p[1]); if (h) onPick(h); } };
  ov.addEventListener('pointerup', up); ov.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); });
  ov.addEventListener('pointerleave', () => { if (S.hover) { S.hover = null; requestDraw(); } showTip(null); });
  ov.addEventListener('wheel', e => { e.preventDefault(); S.zoom = clampZoom(S.zoom * Math.exp(-e.deltaY * 0.0012)); requestDraw(); }, {passive: false});
  ov.addEventListener('contextmenu', e => e.preventDefault());
  ov.addEventListener('dblclick', () => { resetCamera(); requestDraw(); });
  ov.tabIndex = 0;
  ov.addEventListener('keydown', e => { const cam = R.cam, k = e.key; let used = true;
    if (k === 'ArrowLeft') cam.az -= 0.08; else if (k === 'ArrowRight') cam.az += 0.08; else if (k === 'ArrowUp') cam.el = Math.min(1.5, cam.el + 0.06); else if (k === 'ArrowDown') cam.el = Math.max(-0.12, cam.el - 0.06);
    else if (k === '+' || k === '=') S.zoom = clampZoom(S.zoom * 1.12); else if (k === '-' || k === '_') S.zoom = clampZoom(S.zoom / 1.12); else if (k === '0') resetCamera(); else used = false;
    if (used) { e.preventDefault(); requestDraw(); } });
}
function onPick(h) {
  if (h.kind === 'station' || h.kind === 'prof' || h.kind === 'cross') { toggleSelect(h.kind === 'cross' ? h.ref.s.id : h.ref.id); }
  else if (h.kind === 'bio') { S.bioFocus = h.ref; const st = h.ref.stationId && S.ds.byId.get(h.ref.stationId); if (st && !S.sel.includes(st.id)) toggleSelect(st.id); else { renderDetail(); requestDraw(); } }
}
