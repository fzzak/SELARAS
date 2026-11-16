'use strict';
/* =====================================================================================
   Panels: dataset menu, the six locked slots, legend, station table, linked detail,
   profile charts, guided views, the loader dialog and the input-format page.
   ===================================================================================== */
const pill = st => `<span class="pill tone-${STATUS[st].tone}" title="${esc(STATUS[st].hint)}"><i></i>${STATUS[st].label}</span>`;
const primary = () => { const id = S.selOrder[S.selOrder.length - 1]; return id ? S.ds.byId.get(id) : null; };

/* ---------- selection -------------------------------------------------------------- */
function toggleSelect(id, keep) {
  const i = S.sel.indexOf(id);
  if (i >= 0) { if (keep) return; S.sel[i] = null; S.selOrder = S.selOrder.filter(x => x !== id); }
  else { let slot = S.sel.indexOf(null); if (slot < 0) { const old = S.selOrder.shift(); slot = S.sel.indexOf(old); } S.sel[slot] = id; S.selOrder.push(id); }
  const p = primary(); if (!p || !(S.bioFocus && p.nearBio && p.nearBio.o === S.bioFocus)) S.bioFocus = null;
  buildColumns(); requestDraw(); renderDetail(); markTable();
}
function clearSelection() { S.sel = [null, null, null]; S.selOrder = []; S.bioFocus = null; }

/* ---------- dataset ---------------------------------------------------------------- */
function winOptions(ds) { const full = Math.ceil(ds.maxDepth / 100) * 100; return [100, 300, 1000, 3000].filter(d => d < full * 0.85).concat([full]); }
function defaultSurf(v) { const [lo, hi] = varRange(v); if (v === 'temperature_c' && lo < 19.5 && hi > 20.5) return 20; const mid = (lo + hi) / 2, step = niceStep(hi - lo, 20); return Math.round(mid / step) * step; }
function setDataset(entry) {
  S.cur = entry; const ds = S.ds = entry.ds; S.k = 1 / Math.max(ds.halfX, ds.halfY);
  for (const s of SLOTS) S.show[s.id] = ds.slots[s.id].has;
  for (const slot of ['physics', 'chemistry']) { const vs = SLOT_BY_ID[slot].vars.filter(v => ds.varsPresent.includes(v)); S.vars[slot] = vs[0] || SLOT_BY_ID[slot].vars[0]; }
  S.win = winOptions(ds).slice(-1)[0]; S.vscale = 'sqrt'; S.floorColor = 'depth'; S.track = true; S.labels = ds.stations.length <= 14; S.story = -1; S.hover = null; S.hoverDepth = null;
  for (const slot of ['physics', 'chemistry']) S.surf[slot] = {on: false, value: defaultSurf(S.vars[slot])};
  clearSelection(); const first = ds.casts[0] || ds.stations[0]; if (first) { S.sel[0] = first.id; S.selOrder = [first.id]; }
  if (R) resetCamera();
  $('#ds-select').value = entry.key; renderAll();
}
function renderAll() { renderInfo(); renderSlots(); renderStories(); renderTools(); rebuildScene(); renderLegend(); renderTable(); renderDetail(); }
function refreshScene() { rebuildScene(); renderLegend(); renderDetail(); }

function renderMenu() {
  const grp = (label, list) => list.length ? `<optgroup label="${label}">${list.map(e => `<option value="${esc(e.key)}">${esc(e.ds.name)}</option>`).join('')}</optgroup>` : '';
  $('#ds-select').innerHTML = grp('Built in', S.entries.filter(e => e.builtin)) + grp('Loaded in this browser', S.entries.filter(e => !e.builtin));
  if (S.cur) $('#ds-select').value = S.cur.key;
}
function renderInfo() {
  const ds = S.ds, filled = SLOTS.filter(s => ds.slots[s.id].has).length, per = ds.period && ds.period.start ? `${ds.period.start}${ds.period.end ? ' to ' + ds.period.end : ''}` : '';
  const synth = SLOTS.some(s => ds.slots[s.id].status === 'synthetic');
  $('#ds-info').innerHTML = `<h1>${esc(ds.name)}</h1><p class="where">${esc([ds.region, per].filter(Boolean).join(' · '))}</p>
    ${synth ? '<p class="banner crit"><b>Not real data.</b> Generated numbers for testing the format.</p>' : ''}
    ${ds.description ? `<p class="desc">${esc(ds.description)}</p>` : ''}
    <div class="fill" aria-label="${filled} of 6 slots filled">${SLOTS.map(s => `<i class="${ds.slots[s.id].has ? 'on' : ''}"></i>`).join('')}<span>${filled} of 6 slots filled</span></div>`;
}

/* ---------- the six locked slots --------------------------------------------------- */
function renderSlots() {
  const ds = S.ds;
  $('#slot-list').innerHTML = SLOTS.map(sl => {
    const st = ds.slots[sl.id]; let ctl = '';
    if (st.has) {
      if (sl.id === 'seafloor') ctl = `<div class="ctl"><span class="ctl-l">Colour by</span><div class="seg" role="group" aria-label="Seafloor colour">${[['depth', 'Depth'], ['slope', 'Slope']].map(([k, l]) => `<button type="button" data-act="floor" data-v="${k}" aria-pressed="${S.floorColor === k}">${l}</button>`).join('')}</div></div>`;
      if (sl.vars) {
        const vs = sl.vars.filter(v => ds.varsPresent.includes(v)), v = S.vars[sl.id], sf = S.surf[sl.id];
        ctl = `<div class="ctl"><span class="ctl-l">Colour columns by</span><div class="seg wrap" role="group" aria-label="${sl.name} variable">${vs.map(k => `<button type="button" data-act="var" data-slot="${sl.id}" data-v="${k}" aria-pressed="${v === k}"><span class="sw" style="background:${VARS[k].hue}"></span>${VARS[k].label}</button>`).join('')}</div></div>
          <div class="ctl"><label class="chk"><input type="checkbox" id="surf-on-${sl.id}" data-act="surf-on" data-slot="${sl.id}" ${sf.on ? 'checked' : ''}> Surface where ${VARS[v].short} =</label>
          <input type="number" class="num" id="surf-val-${sl.id}" data-act="surf-val" data-slot="${sl.id}" value="${sf.value}" step="${VARS[v].dec > 1 ? 0.1 : 1}" aria-label="${VARS[v].label} value for the surface"> <span class="unit">${VARS[v].unit}</span></div>`;
      }
      if (sl.id === 'stations') ctl = `<div class="ctl"><label class="chk"><input type="checkbox" id="opt-track" data-act="track" ${S.track ? 'checked' : ''} ${ds.track.length ? '' : 'disabled'}> Ship track</label><label class="chk"><input type="checkbox" id="opt-labels" data-act="labels" ${S.labels ? 'checked' : ''}> Name every station</label></div>`;
    }
    const text = st.has ? st.source || 'No source given in dataset.json.' : st.note || 'No file for this slot.';
    return `<li class="slot ${st.has ? '' : 'is-empty'}">
      <div class="slot-top"><span class="num">${sl.n}</span><div class="slot-name"><b>${sl.name}</b><span>${sl.domain}</span></div>
        <label class="switch" title="${st.has ? 'Show or hide in the scene' : 'Nothing to show'}"><input type="checkbox" id="show-${sl.id}" data-act="show" data-slot="${sl.id}" ${S.show[sl.id] ? 'checked' : ''} ${st.has ? '' : 'disabled'}><span class="track"></span><span class="vh">Show ${sl.name}</span></label></div>
      <div class="slot-meta">${pill(st.status)}${st.count ? `<span class="cnt">${st.count}</span>` : ''}</div>
      <p class="src">${esc(text)}</p>${st.has && st.note ? `<p class="src note">${esc(st.note)}</p>` : ''}
      ${st.has ? ctl : `<p class="hint">Add <code>${sl.files[0]}</code> to fill this slot.</p>`}</li>`;
  }).join('');
}
function onSlotInput(e) {
  const t = e.target.closest('[data-act]'); if (!t) return; const act = t.dataset.act, slot = t.dataset.slot;
  if (e.type === 'click' && t.tagName !== 'BUTTON') return; if (e.type === 'change' && t.tagName === 'BUTTON') return;
  if (act === 'show') { S.show[slot] = t.checked; refreshScene(); }
  else if (act === 'floor') { S.floorColor = t.dataset.v; renderSlots(); buildFloor(); requestDraw(); renderLegend(); }
  else if (act === 'var') { S.vars[slot] = t.dataset.v; S.surf[slot].value = defaultSurf(t.dataset.v); renderSlots(); refreshScene(); }
  else if (act === 'surf-on') { S.surf[slot].on = t.checked; refreshScene(); }
  else if (act === 'surf-val') { const x = parseFloat(t.value); if (!Number.isNaN(x)) { S.surf[slot].value = x; S.surf[slot].on = true; $('#surf-on-' + slot).checked = true; refreshScene(); } }
  else if (act === 'track') { S.track = t.checked; requestDraw(); }
  else if (act === 'labels') { S.labels = t.checked; requestDraw(); }
  if (S.story >= 0 && act !== 'track' && act !== 'labels') { S.story = -1; renderStories(); }
}

/* ---------- scene tools, guided views, legend -------------------------------------- */
function renderTools() {
  const ds = S.ds, opts = winOptions(ds);
  $('#tools').innerHTML = `<span class="tl">Show down to</span><div class="seg" role="group" aria-label="Depth shown">${opts.map((d, i) => `<button type="button" data-win="${d}" aria-pressed="${S.win === d}">${i === opts.length - 1 ? 'Full depth' : fmtInt(d) + ' m'}</button>`).join('')}</div>
    <span class="tl">Depth axis</span><div class="seg" role="group" aria-label="Depth axis">${[['sqrt', 'Stretched', 'Square-root scale: shallow water gets more room'], ['lin', 'True scale', 'Linear depth, exaggerated vertically']].map(([k, l, t]) => `<button type="button" data-vs="${k}" title="${t}" aria-pressed="${S.vscale === k}">${l}</button>`).join('')}</div>
    <button type="button" class="btn sm" id="btn-reset">Reset view</button>`;
}
function onTools(e) {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.win) { S.win = +b.dataset.win; renderTools(); refreshScene(); }
  else if (b.dataset.vs) { S.vscale = b.dataset.vs; renderTools(); refreshScene(); }
  else if (b.id === 'btn-reset' && R) { resetCamera(); requestDraw(); }
}
function renderStories() {
  const st = S.ds.stories;
  $('#stories').innerHTML = `<span class="st-l">Guided views</span><button type="button" data-story="-1" aria-pressed="${S.story < 0}">Explore freely</button>` + st.map((s, i) => `<button type="button" data-story="${i}" aria-pressed="${S.story === i}"><span class="st-n">${i + 1}</span>${esc(s.title)}</button>`).join('') + (st.length ? '' : '<span class="st-none">This location has no guided views. Add a "stories" list to dataset.json.</span>');
  const box = $('#story-text'); if (S.story >= 0) { box.hidden = false; box.innerHTML = `<b>${esc(st[S.story].title)}.</b> ${esc(st[S.story].text || '')}`; } else box.hidden = true;
}
function applyStory(i) {
  S.story = i; const ds = S.ds; if (i < 0) { renderStories(); return; } const st = ds.stories[i];
  if (Array.isArray(st.show)) for (const s of SLOTS) S.show[s.id] = st.show.includes(s.id) && ds.slots[s.id].has;
  const opts = winOptions(ds); if (st.depth_window) S.win = opts.reduce((a, b) => Math.abs(b - st.depth_window) < Math.abs(a - st.depth_window) ? b : a); else S.win = opts[opts.length - 1];
  const setVar = v => { if (VARS[v] && ds.varsPresent.includes(v)) { S.vars[VARS[v].slot] = v; S.surf[VARS[v].slot] = {on: false, value: defaultSurf(v)}; } };
  for (const slot of ['physics', 'chemistry']) S.surf[slot].on = false;
  if (st.variable) setVar(st.variable);
  if (st.surface && VARS[st.surface.variable] && ds.varsPresent.includes(st.surface.variable)) { setVar(st.surface.variable); S.surf[VARS[st.surface.variable].slot] = {on: true, value: +st.surface.value}; }
  if (Array.isArray(st.select)) { clearSelection(); for (const id of st.select.slice(0, 3)) if (ds.byId.has(id)) { S.sel[S.selOrder.length] = id; S.selOrder.push(id); } }
  if (R) resetCamera(st.camera || {});
  renderSlots(); renderStories(); renderTools(); rebuildScene(); renderLegend(); renderTable(); renderDetail();
}
function renderLegend() {
  const ds = S.ds, out = [], f1 = (x, V) => fmt(x, V.dec > 1 ? 1 : V.dec);
  const bar = (ramp, a, b, title, note = '') => `<div class="lg"><span class="lg-t">${title}</span><span class="lg-v">${a}</span><span class="lg-bar" style="background:${rampCss(ramp)}"></span><span class="lg-v">${b}</span>${note ? `<span class="lg-n">${note}</span>` : ''}</div>`;
  if (visibleSlot('seafloor')) out.push(S.floorColor === 'slope' ? bar(RAMP.slope, '0°', '30°+', 'Seafloor slope') : bar(t => RAMP.depth(Math.pow(t, 0.6)), '0', fmtInt(Math.min(S.win, ds.maxDepth)) + ' m', 'Seafloor depth'));
  for (const slot of ['physics', 'chemistry']) { if (!visibleSlot(slot)) continue; const v = S.vars[slot], [lo, hi] = varRange(v), V = VARS[v];
    out.push(bar(RAMP[v], f1(lo, V), f1(hi, V) + ' ' + V.unit, V.label));
    const info = S.surfInfo[slot]; if (info) out.push(`<div class="lg"><span class="sw" style="background:${V.hue}"></span><span class="lg-t">${V.short} = ${+info.value.toFixed(3)} ${V.unit} surface</span><span class="lg-n">${info.n >= 3 ? `${fmtInt(info.min)} to ${fmtInt(info.max)} m deep, interpolated between ${info.n} casts` : `needs 3 casts that cross this value; found ${info.n}`}</span></div>`); }
  if (visibleSlot('currents')) out.push(bar(RAMP.speed, '0', fmt(S.curMax, 2) + ' m/s', 'Current speed', 'longer arrow = faster'));
  if (visibleSlot('biology')) { const q = ds.samples.some(b => !Number.isNaN(b.shannon)); out.push(bar(t => RAMP.bio(0.2 + 0.8 * t), q ? 'low' : '', q ? 'high' : '', q ? 'Biology: diversity H′' : 'Biology samples', 'larger circle = more taxa')); }
  if (visibleSlot('stations')) { const types = [...new Map(ds.stations.map(s => [String(s.type).toLowerCase(), s.type])).values()].slice(0, 9);
    out.push(`<div class="lg">${types.map(t => `<span class="lg-s"><canvas width="18" height="18" data-shape="${shapeOf(t)}"></canvas>${esc(t)}</span>`).join('')}</div>`); }
  if ((visibleSlot('physics') || visibleSlot('chemistry')) && ds.casts.some(s => s.prof.flag.includes(1))) out.push('<div class="lg"><span class="sw" style="background:#808893"></span><span class="lg-n">grey column = extended by software, not measured</span></div>');
  const ex = HWATER * Math.max(ds.halfX, ds.halfY) / (S.win / 1000);
  if (S.vscale !== 'sqrt') out.push(`<div class="lg"><span class="lg-n">Depth drawn about ${fmtInt(ex)}× taller than true scale</span></div>`);
  $('#legend').innerHTML = out.join('');
  for (const c of document.querySelectorAll('#legend canvas')) { const x = c.getContext('2d'); x.clearRect(0, 0, 18, 18); marker(x, c.dataset.shape, 9, 9, 4.6, '#efe6cf', 'rgba(10,14,19,.9)'); }
}

/* ---------- station table ---------------------------------------------------------- */
function renderTable() {
  const ds = S.ds, hp = ds.slots.physics.has, hc = ds.slots.chemistry.has, hb = ds.slots.biology.has, hT = ds.varsPresent.includes('temperature_c');
  const cols = [['Station', s => `<span class="dot"></span>${esc(s.id)}`], ['Type', s => esc(s.type)], ['Time (UTC)', s => fmtTime(s.time)], ['Seafloor m', s => s.floor > 0 ? fmtInt(s.floor) : '–', 1], ['Slope °', s => fmt(s.slope, 0), 1]];
  if (hp && hT) cols.push(['Surface °C', s => fmt(s.metrics.sst, 1), 1], ['Mixed layer m', s => fmt(s.metrics.mld, 0), 1], ['Thermocline m', s => fmt(s.metrics.tcline, 0), 1]);
  if (hp && ds.varsPresent.includes('salinity_psu')) cols.push(['Salinity max', s => fmt(s.metrics.smax, 2), 1]);
  if (hc && ds.varsPresent.includes('oxygen_umol_kg')) cols.push(['O₂ min µmol/kg', s => fmt(s.metrics.o2min, 0), 1]);
  if (hc && ds.varsPresent.includes('chlorophyll_mg_m3')) cols.push(['Chl max at m', s => fmt(s.metrics.chlmaxd, 0), 1]);
  if (hp || hc) cols.push(['Measured to m', s => fmt(s.metrics.measuredTo, 0), 1]);
  if (hb) cols.push(['Taxa nearby', s => s.nearBio ? `${fmtInt(s.nearBio.o.richness)} <span class="t-dim">${s.nearBio.km < 0.05 ? 'here' : fmt(s.nearBio.km, 1) + ' km'}</span>` : '–', 1]);
  $('#st-table').innerHTML = `<thead><tr>${cols.map(c => `<th${c[2] ? ' class="n"' : ''}>${c[0]}</th>`).join('')}</tr></thead><tbody>${ds.stations.map(s => `<tr data-id="${esc(s.id)}" tabindex="0">${cols.map(c => `<td${c[2] ? ' class="n"' : ''}>${c[1](s)}</td>`).join('')}</tr>`).join('')}</tbody>`;
  markTable();
}
function markTable() { for (const tr of document.querySelectorAll('#st-table tbody tr')) { const i = S.sel.indexOf(tr.dataset.id); tr.classList.toggle('on', i >= 0); tr.style.setProperty('--c', i >= 0 ? SEL[i] : 'transparent'); tr.setAttribute('aria-selected', i >= 0); } }

/* ---------- linked detail: what every slot says at the selected station ------------ */
function renderDetail() {
  const ds = S.ds, p = primary(), ids = S.selOrder;
  $('#sel-head').innerHTML = ids.length ? ids.map(id => `<button type="button" class="chip" data-id="${esc(id)}" title="Remove from comparison"><i style="background:${SEL[S.sel.indexOf(id)]}"></i>${esc(id)}<span aria-hidden="true">×</span></button>`).join('') + '<span class="sel-hint">Compare up to three.</span>' : '<span class="sel-hint">Click a station in the scene or the table.</span>';
  if (!p) { $('#linked').innerHTML = ''; $('#charts').innerHTML = ''; $('#readout').innerHTML = ''; $('#bio').innerHTML = ''; return; }
  const row = (slot, html, from) => `<li class="${ds.slots[slot].has ? '' : 'none'}"><span class="num">${SLOT_BY_ID[slot].n}</span><div><span class="lk-n">${SLOT_BY_ID[slot].name}${from ? ` <span class="from">${from}</span>` : ''}</span><span class="lk-v">${html}</span></div></li>`;
  const none = slot => `<span class="t-dim">${esc(ds.slots[slot].note || 'No data in this location.')}</span>`;
  const src = k => { const n = p[k]; return n ? {m: n.o.metrics, from: n.o !== p ? `from ${esc(n.o.id)}, ${fmt(n.km, 1)} km away` : ''} : {m: {}, from: ''}; };
  const ph_ = src('nearPhys'), ch_ = src('nearChem'), m = ph_.m, mc = ch_.m, phys = [], chem = [];
  if (m.sst !== undefined) phys.push(`surface <b>${fmt(m.sst, 1)} °C</b>`); if (m.mld !== undefined) phys.push(`mixed layer <b>${fmt(m.mld, 0)} m</b>`);
  if (m.tcline !== undefined) phys.push(`thermocline <b>${fmt(m.tcline, 0)} m</b> (${fmt(m.tgrad, 2)} °C/m)`); if (m.smax !== undefined) phys.push(`salinity max <b>${fmt(m.smax, 2)}</b> at ${fmt(m.smaxd, 0)} m`);
  if (mc.o2min !== undefined) chem.push(`oxygen minimum <b>${fmt(mc.o2min, 0)} µmol/kg</b> at ${fmt(mc.o2mind, 0)} m`); if (mc.chlmax !== undefined) chem.push(`chlorophyll maximum <b>${fmt(mc.chlmax, 2)} mg/m³</b> at ${fmt(mc.chlmaxd, 0)} m`);
  const cur = p.nearCur, bio = S.bioFocus ? {o: S.bioFocus, km: Math.hypot(S.bioFocus.x - p.x, S.bioFocus.y - p.y)} : p.nearBio;
  $('#linked').innerHTML = `<h3>What each slot says at ${esc(p.id)}</h3><ol class="linked">
    ${row('seafloor', Number.isNaN(p.floor) ? '<span class="t-dim">Outside the seafloor grid.</span>' : p.floor <= 0 ? `On land, ${fmtInt(-p.floor)} m above sea level` : `<b>${fmtInt(p.floor)} m</b> deep, slope <b>${fmt(p.slope, 0)}°</b>, relief ${fmtInt(p.relief)} m between neighbouring cells`)}
    ${row('physics', !ds.slots.physics.has ? none('physics') : phys.length ? phys.join(', ') : '<span class="t-dim">No cast with temperature or salinity.</span>', ds.slots.physics.has && phys.length ? ph_.from : '')}
    ${row('chemistry', !ds.slots.chemistry.has ? none('chemistry') : chem.length ? chem.join(', ') : '<span class="t-dim">Turbidity only; no oxygen or chlorophyll.</span>', ds.slots.chemistry.has && chem.length ? ch_.from : '')}
    ${row('currents', !ds.slots.currents.has ? none('currents') : `<b>${fmt(cur.o.speed, 2)} m/s</b> toward ${compass((Math.atan2(cur.o.u, cur.o.v) * 180 / Math.PI + 360) % 360)} at ${fmtInt(cur.o.depth)} m`, ds.slots.currents.has ? `${fmt(cur.km, 1)} km away` : '')}
    ${row('biology', !ds.slots.biology.has ? none('biology') : `<b>${plural(bio.o.richness, 'taxon', 'taxa')}</b>${Number.isNaN(bio.o.shannon) ? '' : `, diversity H′ <b>${fmt(bio.o.shannon, 2)}</b>`} in ${esc(bio.o.id)}`, ds.slots.biology.has ? (bio.km < 0.05 ? 'sampled here' : `${fmt(bio.km, 1)} km away`) : '')}
    ${row('stations', `${esc(p.type)}, ${fmtTime(p.time)} UTC, ${fmtLat(p.lat)} ${fmtLon(p.lon)}${p.label ? `<span class="lk-note">${esc(p.label)}</span>` : ''}`)}</ol>`;
  renderCharts(); renderBio(ds.slots.biology.has ? bio : null);
}

/* ---------- profile charts (small multiples, one variable each) -------------------- */
const CH = {W: 184, H: 232, l: 38, r: 10, t: 8, b: 24};
function chartDepth() { let m = 0; for (const s of S.ds.casts) m = Math.max(m, s.prof.depth[s.prof.depth.length - 1]); return Math.min(S.win, Math.max(m, 10)); }
const chartY = (d, dm) => { const f = Math.min(1.05, d / dm); return CH.t + (S.vscale === 'sqrt' ? Math.sqrt(f) : f) * (CH.H - CH.t - CH.b); };
function renderCharts() {
  const ds = S.ds, vs = ds.varsPresent, sel = S.selOrder.map(id => ds.byId.get(id)).filter(s => s.prof), pw = CH.W - CH.l - CH.r, ph = CH.H - CH.t - CH.b;
  if (!vs.length) { $('#charts').innerHTML = '<p class="empty">This location has no profiles. Add profiles.csv to fill slots 2 and 3.</p>'; $('#readout').innerHTML = ''; return; }
  const dm = chartDepth(), Y = d => chartY(d, dm); let yt = '', lastY = -99;
  const ticks = S.vscale === 'sqrt' ? DEPTH_TICKS.filter(d => d <= dm) : Array.from({length: Math.floor(dm / niceStep(dm, 4) + 1e-6) + 1}, (_, i) => i * niceStep(dm, 4));
  for (const d of ticks) { if (Y(d) - lastY < 15) continue; lastY = Y(d); yt += `<line x1="${CH.l}" x2="${CH.l + pw}" y1="${Y(d)}" y2="${Y(d)}" class="grid"/><text x="${CH.l - 5}" y="${Y(d) + 3.5}" text-anchor="end">${fmtInt(d)}</text>`; }
  $('#charts').innerHTML = (sel.length ? '' : '<p class="empty">The selected station has no cast. Grey lines show every cast in this location.</p>') + vs.map(v => {
    let [lo, hi] = varRange(v); const pad = (hi - lo) * 0.06; lo -= pad; hi += pad; const X = x => CH.l + (x - lo) / (hi - lo) * pw, V = VARS[v];
    const paths = s => { const a = s.prof.vars[v]; if (!a) return ['', '']; const d = s.prof.depth, f = s.prof.flag; let me = '', ex = '', px = null, py = null, pen = false;
      for (let i = 0; i < a.length; i++) { if (Number.isNaN(a[i])) continue; const x = X(a[i]).toFixed(1), y = Y(d[i]).toFixed(1);
        if (px !== null) { if (f[i] === 1) { ex += `M${px} ${py}L${x} ${y}`; pen = false; } else { me += pen ? `L${x} ${y}` : `M${px} ${py}L${x} ${y}`; pen = true; } }
        px = x; py = y; if (d[i] > dm) break; }
      return [me, ex]; };
    const ctx = ds.casts.filter(s => !S.sel.includes(s.id)).map(s => { const [me, ex] = paths(s); return `<path d="${me}${ex}" class="ctx"/>`; }).join('');
    const lines = sel.map(s => { const [me, ex] = paths(s), c = SEL[S.sel.indexOf(s.id)]; return `<path d="${ex}" class="ext"/><path d="${me}" class="ln" stroke="${c}"/>`; }).join('');
    const xs = niceStep(hi - lo, 3); let xt = ''; for (let x = Math.ceil(lo / xs) * xs; x <= hi + 1e-9; x += xs) xt += `<line x1="${X(x)}" x2="${X(x)}" y1="${CH.t + ph}" y2="${CH.t + ph + 4}" class="axis"/><text x="${X(x)}" y="${CH.t + ph + 15}" text-anchor="middle">${+x.toFixed(4)}</text>`;
    return `<figure class="chart"><figcaption><span class="sw" style="background:${V.hue}"></span>${V.label} <span class="unit">${V.unit}</span></figcaption>
      <svg viewBox="0 0 ${CH.W} ${CH.H}" role="img" aria-label="${V.label} against depth in metres for the selected stations"><defs><clipPath id="cp-${v}"><rect x="${CH.l}" y="${CH.t}" width="${pw}" height="${ph}"/></clipPath></defs>
      ${yt}${xt}<line x1="${CH.l}" x2="${CH.l}" y1="${CH.t}" y2="${CH.t + ph}" class="axis"/><line x1="${CH.l}" x2="${CH.l + pw}" y1="${CH.t + ph}" y2="${CH.t + ph}" class="axis"/>
      <g clip-path="url(#cp-${v})">${ctx}${lines}</g><line class="xh" x1="${CH.l}" x2="${CH.l + pw}" y1="0" y2="0" visibility="hidden"/></svg></figure>`;
  }).join('');
  setHoverDepth(null);
}
function setHoverDepth(d) {
  S.hoverDepth = d; const ds = S.ds, y = d === null ? 0 : chartY(d, chartDepth());
  for (const l of document.querySelectorAll('#charts .xh')) { l.setAttribute('y1', y); l.setAttribute('y2', y); l.setAttribute('visibility', d === null ? 'hidden' : 'visible'); }
  const sel = S.selOrder.map(id => ds.byId.get(id)).filter(s => s.prof), vs = ds.varsPresent;
  if (!sel.length || !vs.length) { $('#readout').innerHTML = ''; return; }
  $('#readout').innerHTML = `<table><thead><tr><th>${d === null ? 'Hover a chart to read values' : `At ${fmtInt(d)} m`}</th>${vs.map(v => `<th class="n">${VARS[v].short} <span class="unit">${VARS[v].unit}</span></th>`).join('')}</tr></thead><tbody>${sel.map(s => `<tr><td><i style="background:${SEL[S.sel.indexOf(s.id)]}"></i>${esc(s.id)}</td>${vs.map(v => `<td class="n">${d === null || !s.prof.vars[v] ? '–' : fmt(interpAt(s.prof.depth, s.prof.vars[v], d), VARS[v].dec)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function onChartMove(e) {
  const svg = e.target.closest('svg'); if (!svg) { if (S.hoverDepth !== null) setHoverDepth(null); return; }
  const r = svg.getBoundingClientRect(), y = (e.clientY - r.top) / r.height * CH.H, f = (y - CH.t) / (CH.H - CH.t - CH.b), dm = chartDepth(), d = (S.vscale === 'sqrt' ? f * f : f) * dm;
  setHoverDepth(f >= 0 && f <= 1 ? d : null);
}

/* ---------- biology panel ---------------------------------------------------------- */
function renderBio(link) {
  if (!link) { $('#bio').innerHTML = ''; return; } const b = link.o, top = b.taxa.slice(0, 8), max = top[0] ? top[0].value : 1;
  const unit = b.valueType === 'reads' ? 'reads' : b.valueType === 'cover_pct' ? '% cover' : b.quant ? 'count' : '';
  $('#bio').innerHTML = `<h3>Biology in ${esc(b.id)}</h3>
    <p class="bio-meta">${esc(b.method || 'Sample')} at ${fmtInt(b.depth)} m, ${link.km < 0.05 ? 'at this station' : fmt(link.km, 1) + ' km from this station'}${b.nearCast ? `. Nearest cast: ${esc(b.nearCast.o.id)} (${fmt(b.nearCast.km, 1)} km).` : '.'}</p>
    <div class="stats"><div><b>${fmtInt(b.richness)}</b><span>taxa</span></div>${Number.isNaN(b.shannon) ? '' : `<div><b>${fmt(b.shannon, 2)}</b><span>diversity H′</span></div>`}${b.quant ? `<div><b>${fmtInt(b.total)}</b><span>${unit || 'total'}</span></div>` : ''}</div>
    ${b.quant ? `<ul class="bars" aria-label="Most abundant taxa">${top.map(t => `<li title="${esc(t.group)}"><span class="bn"><em>${esc(t.name)}</em></span><span class="bb"><i style="width:${Math.max(2, t.value / max * 100)}%"></i></span><span class="bv">${fmt(t.value / b.total * 100, 0)}%</span></li>`).join('')}</ul>${b.taxa.length > 8 ? `<p class="more">and ${plural(b.taxa.length - 8, 'more taxon', 'more taxa')}</p>` : ''}` : `<p class="taxa-list">${b.taxa.slice(0, 30).map(t => `<em>${esc(t.name)}</em>`).join(', ')}${b.taxa.length > 30 ? '…' : ''}</p>`}
    <p class="groups">${b.groups.map(g => `<span>${esc(g[0])} <b>${g[1]}</b></span>`).join('')}</p>`;
}

/* ---------- loading a location from files ------------------------------------------ */
const pending = {files: null, name: '', result: null};
async function takeFiles(list, folderName) {
  // list: [{path, file}] ; keep the shallowest copy of each base name
  const best = new Map();
  for (const it of list) { const base = it.path.split('/').pop().toLowerCase(), depth = it.path.split('/').length; if (base.startsWith('.')) continue; if (!best.has(base) || best.get(base).depth > depth) best.set(base, {depth, file: it.file}); }
  const map = new Map(), wanted = n => FILE_BY_NAME[n] || n.endsWith('.asc');
  for (const [name, {file}] of best) {
    if (!wanted(name)) { map.set(name, ''); continue; }
    if (file.size > 120e6) { map.set(name, ''); continue; }
    map.set(name, await file.text());
  }
  pending.files = map; pending.name = folderName || 'Loaded location';
  $('#load-report').innerHTML = '<p class="empty">Reading files…</p>';
  await new Promise(r => setTimeout(r, 20));
  try { pending.result = buildDataset(map, pending.name); } catch (e) { pending.result = {ds: null, report: {items: [{file: 'folder', state: 'error', summary: '', msgs: [{level: 'error', text: 'Could not read these files: ' + e.message}]}], nErr: 1, nWarn: 0}}; }
  renderReport();
}
function renderReport() {
  const res = pending.result; if (!res) { $('#load-report').innerHTML = ''; $('#btn-open').disabled = true; return; }
  const {report, ds} = res, word = {ok: 'Ready', warn: 'Check', error: 'Fix', missing: 'Missing', absent: 'Not in folder', ignored: 'Ignored'}, tone = {ok: 'good', warn: 'warn', error: 'crit', missing: 'crit', absent: 'none', ignored: 'none'};
  $('#load-report').innerHTML = `<p class="verdict ${ds ? (report.nWarn ? 'warn' : 'good') : 'crit'}"><b>${ds ? (report.nWarn ? `This folder can be opened, with ${plural(report.nWarn, 'thing')} to check.` : 'This folder matches the format.') : `This folder cannot be opened yet: ${plural(report.nErr, 'problem')} to fix.`}</b>${ds ? ` ${SLOTS.filter(s => ds.slots[s.id].has).length} of 6 slots will be filled.` : ''}</p>
    <table class="report"><thead><tr><th>File</th><th>Slot</th><th>Result</th><th>Details</th></tr></thead><tbody>${report.items.map(it => `<tr><td><code>${esc(it.file)}</code></td><td>${it.slot ? esc(it.slot) : '–'}</td><td><span class="pill tone-${tone[it.state]}"><i></i>${word[it.state]}</span></td>
      <td>${it.summary ? `<span class="sum">${esc(it.summary)}</span>` : ''}${it.msgs.length ? `<ul>${it.msgs.map(m => `<li class="m-${m.level}">${esc(m.text)}</li>`).join('')}</ul>` : (it.state === 'absent' ? '<span class="t-dim">Optional. The slot stays empty.</span>' : '')}</td></tr>`).join('')}</tbody></table>`;
  $('#btn-open').disabled = !ds;
}
async function entriesFromDrop(items) {
  const out = []; let top = '';
  const walk = (entry, path) => new Promise(res => {
    if (entry.isFile) entry.file(f => { out.push({path: path + entry.name, file: f}); res(); }, () => res());
    else if (entry.isDirectory) { if (!top) top = entry.name; const rd = entry.createReader(); const all = []; const more = () => rd.readEntries(async es => { if (!es.length) { for (const e of all) await walk(e, path + entry.name + '/'); res(); } else { all.push(...es); more(); } }, () => res()); more(); }
    else res();
  });
  const roots = []; for (const it of items) { const e = it.webkitGetAsEntry ? it.webkitGetAsEntry() : null; if (e) roots.push(e); else if (it.getAsFile) { const f = it.getAsFile(); if (f) out.push({path: f.name, file: f}); } }
  for (const e of roots) await walk(e, '');
  return {list: out, name: top};
}
function openLoaded() {
  const res = pending.result; if (!res || !res.ds) return;
  const key = 'user:' + res.ds.id + ':' + Date.now(), files = {}; for (const [k, v] of pending.files) if (v !== '') files[k] = v;
  const entry = {key, builtin: false, ds: res.ds, report: res.report}; S.entries.push(entry);
  idbPut({key, name: pending.name, files, savedAt: Date.now()}).then(ok => { entry.saved = ok; renderSaved(); });
  renderMenu(); setDataset(entry); $('#dlg-load').close(); pending.result = null; pending.files = null; renderReport();
}
function renderSaved() {
  const mine = S.entries.filter(e => !e.builtin);
  $('#saved').innerHTML = mine.length ? `<h3>Loaded in this browser</h3><ul>${mine.map(e => `<li><span>${esc(e.ds.name)}</span><button type="button" class="btn sm" data-open="${esc(e.key)}">Open</button><button type="button" class="btn sm" data-del="${esc(e.key)}">Remove</button></li>`).join('')}</ul><p class="t-dim">Kept in this browser only. Other people and other devices do not see them.</p>` : '';
}

/* ---------- remembering loaded locations (this browser only) ----------------------- */
function idb() { return new Promise(res => { try { const rq = indexedDB.open('selaras', 1); rq.onupgradeneeded = () => rq.result.createObjectStore('datasets', {keyPath: 'key'}); rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null); } catch (e) { res(null); } }); }
async function idbPut(rec) { const db = await idb(); if (!db) return false; return new Promise(res => { try { const tx = db.transaction('datasets', 'readwrite'); tx.objectStore('datasets').put(rec); tx.oncomplete = () => res(true); tx.onerror = tx.onabort = () => res(false); } catch (e) { res(false); } }); }
async function idbAll() { const db = await idb(); if (!db) return []; return new Promise(res => { try { const rq = db.transaction('datasets').objectStore('datasets').getAll(); rq.onsuccess = () => res(rq.result || []); rq.onerror = () => res([]); } catch (e) { res([]); } }); }
async function idbDel(key) { const db = await idb(); if (!db) return; try { db.transaction('datasets', 'readwrite').objectStore('datasets').delete(key); } catch (e) { /* nothing to remove */ } }

/* ---------- the input-format page --------------------------------------------------- */
function renderFormat() {
  $('#format-body').innerHTML = `<p class="lead">One location is one folder. The file names, column names and units below are locked; the rows are yours. A slot whose file is missing stays empty in the app.</p>
    <div class="tree"><code>my_location/</code>${FILES.map(f => `<div><code>${f.name}</code><span>${f.required ? 'required' : 'optional'}${f.slot ? ' · slot: ' + f.slot : ''}</span></div>`).join('')}</div>
    <h3>Rules for every file</h3><ul class="rules"><li>Positions are decimal degrees in WGS84. Depth is in metres, positive down. Times are UTC in ISO 8601.</li><li>CSV files have one header row. Commas or semicolons both work, and so do decimal commas in semicolon files.</li><li>Leave a cell blank when a value was not measured. Do not write 0 or -999.</li><li>Extra columns and extra files are ignored and reported, never guessed at.</li></ul>
    ${FILES.map(f => `<section class="fmt"><h3><code>${f.name}</code> <span class="req ${f.required ? 'is' : ''}">${f.required ? 'required' : 'optional'}</span></h3><p>${esc(f.purpose)}</p>
      ${f.columns ? `<div class="hdr"><code id="hdr-${f.name.replace('.', '-')}">${f.columns.map(c => c.n).join(',')}</code><button type="button" class="btn sm" data-copy="hdr-${f.name.replace('.', '-')}">Copy header row</button></div>
        <div class="scroll"><table class="cols"><thead><tr><th>Column</th><th>Unit or type</th><th>Needed</th><th>Meaning</th></tr></thead><tbody>${f.columns.map(c => `<tr><td><code>${c.n}</code></td><td>${esc(c.unit || (c.t === 'time' ? 'UTC time' : c.t === 'num' ? 'number' : 'text'))}</td><td>${c.req ? 'yes' : ''}</td><td>${esc(c.d)}${c.alias ? `<span class="alias">Also read: ${c.alias.join(', ')}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : `<div class="scroll"><table class="cols"><thead><tr><th>${f.kind === 'json' ? 'Key' : 'Header line'}</th><th>Type</th><th>Needed</th><th>Meaning</th></tr></thead><tbody>${f.keys.map(k => `<tr><td><code>${k[0]}</code></td><td>${k[1]}</td><td>${k[2] ? 'yes' : ''}</td><td>${esc(k[3])}</td></tr>`).join('')}</tbody></table></div>`}</section>`).join('')}
    <section class="fmt"><h3>Status words</h3><p>Each slot in <code>dataset.json</code> carries one status, shown next to the slot so nobody mistakes a stand-in for a measurement.</p><ul class="rules">${Object.entries(STATUS).filter(([k]) => k !== 'unlabelled').map(([k, v]) => `<li>${pill(k)} <code>${k}</code> ${esc(v.hint)}</li>`).join('')}</ul>
    <p>Rows in <code>profiles.csv</code> can also carry a <code>flag</code>: measured, extended (padding added by software, drawn grey) or modelled.</p></section>`;
}

/* ---------- example folder as a .zip, built in the browser (standalone site only) ---- */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = -1; for (let i = 0; i < u8.length; i++) c = (c >>> 8) ^ CRC_T[(c ^ u8[i]) & 255]; return (c ^ -1) >>> 0; }
function makeZip(files) {                       // files: [{name, text}] -> Blob (stored, no compression)
  const enc = new TextEncoder(), parts = [], central = []; let offset = 0;
  const u16 = n => [n & 255, (n >>> 8) & 255], u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  for (const f of files) {
    const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data);
    const head = [0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)];
    parts.push(new Uint8Array(head), name, data); central.push({name, crc, size: data.length, offset}); offset += head.length + name.length + data.length;
  }
  const start = offset;
  for (const c of central) {
    const h = [0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c.crc), ...u32(c.size), ...u32(c.size), ...u16(c.name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(c.offset)];
    parts.push(new Uint8Array(h), c.name); offset += h.length + c.name.length;
  }
  parts.push(new Uint8Array([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length), ...u32(offset - start), ...u32(start), ...u16(0)]));
  return new Blob(parts, {type: 'application/zip'});
}
function exampleZip(builtin) { const key = builtin.null_island_test ? 'null_island_test' : Object.keys(builtin)[0]; return {key, blob: makeZip(Object.entries(builtin[key]).map(([n, text]) => ({name: key + '/' + n, text})))}; }

/* ---------- start ------------------------------------------------------------------- */
async function init() {
  const builtin = JSON.parse($('#builtin').textContent);
  for (const key of Object.keys(builtin)) { const {ds, report} = buildDataset(new Map(Object.entries(builtin[key])), key); if (ds) S.entries.push({key: 'builtin:' + key, builtin: true, ds, report}); }
  initScene(); renderMenu(); renderFormat(); setDataset(S.entries[0]);
  if (SELARAS_SITE) { $('#example-dl').innerHTML = '<p class="t-dim">New here? <button type="button" class="btn sm" id="btn-example">Download an example folder (.zip)</button> to see every file filled in. It holds generated test numbers, not real data.</p>';
    $('#btn-example').addEventListener('click', () => { const {key, blob} = exampleZip(builtin), a = document.createElement('a'), url = URL.createObjectURL(blob); a.href = url; a.download = key + '.zip'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); }); }
  $('#ds-select').addEventListener('change', e => { const en = S.entries.find(x => x.key === e.target.value); if (en) setDataset(en); });
  $('#slot-list').addEventListener('change', onSlotInput); $('#slot-list').addEventListener('click', onSlotInput);
  $('#tools').addEventListener('click', onTools);
  $('#stories').addEventListener('click', e => { const b = e.target.closest('button[data-story]'); if (b) applyStory(+b.dataset.story); });
  const pickRow = e => { const tr = e.target.closest('tr[data-id]'); if (tr && (e.type === 'click' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleSelect(tr.dataset.id); } };
  $('#st-table').addEventListener('click', pickRow); $('#st-table').addEventListener('keydown', pickRow);
  $('#sel-head').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) toggleSelect(b.dataset.id); });
  $('#charts').addEventListener('pointermove', onChartMove); $('#charts').addEventListener('pointerleave', () => setHoverDepth(null));
  // dialogs
  const dl = $('#dlg-load'), df = $('#dlg-format');
  $('#btn-load').addEventListener('click', () => { renderSaved(); dl.showModal(); });
  $('#btn-format').addEventListener('click', () => df.showModal());
  $('#link-format').addEventListener('click', e => { e.preventDefault(); dl.close(); df.showModal(); });
  for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => b.closest('dialog').close());
  for (const d of [dl, df]) d.addEventListener('click', e => { if (e.target === d) d.close(); });
  $('#pick-folder').addEventListener('change', e => { const fs = [...e.target.files]; if (fs.length) takeFiles(fs.map(f => ({path: f.webkitRelativePath || f.name, file: f})), (fs[0].webkitRelativePath || '').split('/')[0]); e.target.value = ''; });
  $('#pick-files').addEventListener('change', e => { const fs = [...e.target.files]; if (fs.length) takeFiles(fs.map(f => ({path: f.name, file: f})), ''); e.target.value = ''; });
  const dz = $('#drop');
  for (const ev of ['dragenter', 'dragover']) dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); });
  for (const ev of ['dragleave', 'drop']) dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); });
  dz.addEventListener('drop', async e => { const {list, name} = await entriesFromDrop([...e.dataTransfer.items]); if (list.length) takeFiles(list, name); });
  $('#btn-open').addEventListener('click', openLoaded);
  $('#saved').addEventListener('click', e => { const o = e.target.closest('[data-open]'), d = e.target.closest('[data-del]');
    if (o) { const en = S.entries.find(x => x.key === o.dataset.open); if (en) { setDataset(en); dl.close(); } }
    if (d) { const key = d.dataset.del; S.entries = S.entries.filter(x => x.key !== key); idbDel(key); if (S.cur.key === key) setDataset(S.entries[0]); renderMenu(); renderSaved(); } });
  $('#format-body').addEventListener('click', async e => { const b = e.target.closest('[data-copy]'); if (!b) return; const el = document.getElementById(b.dataset.copy);
    try { await navigator.clipboard.writeText(el.textContent); b.textContent = 'Copied'; } catch (err) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); b.textContent = 'Selected: press Ctrl+C'; }
    setTimeout(() => { b.textContent = 'Copy header row'; }, 2200); });
  // locations saved earlier in this browser
  const saved = await idbAll();
  for (const rec of saved.sort((a, b) => a.savedAt - b.savedAt)) { try { const {ds, report} = buildDataset(new Map(Object.entries(rec.files)), rec.name); if (ds) S.entries.push({key: rec.key, builtin: false, ds, report, saved: true}); } catch (e) { /* skip a record that no longer parses */ } }
  if (saved.length) renderMenu();
}
init();
