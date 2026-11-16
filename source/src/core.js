'use strict';
/* =====================================================================================
   SELARAS core: the locked data list, file parsing, validation and the dataset model.
   Everything the app knows about the input format lives in SLOTS, VARS and FILES, so
   the loader, the validation report and the "Input format" page can never disagree.
   ===================================================================================== */
const FORMAT_VERSION = 1;

const VARS = {
  temperature_c:     {label: 'Temperature',      short: 'T',    unit: '°C',      slot: 'physics',   hue: '#d95926', dec: 2, plausible: [-2.5, 40]},
  salinity_psu:      {label: 'Salinity',         short: 'S',    unit: 'PSU',     slot: 'physics',   hue: '#199e70', dec: 2, plausible: [0, 42]},
  oxygen_umol_kg:    {label: 'Dissolved oxygen', short: 'O₂',   unit: 'µmol/kg', slot: 'chemistry', hue: '#9085e9', dec: 0, plausible: [0, 500]},
  chlorophyll_mg_m3: {label: 'Chlorophyll',      short: 'Chl',  unit: 'mg/m³',   slot: 'chemistry', hue: '#0ca30c', dec: 2, plausible: [0, 100]},
  turbidity_ntu:     {label: 'Turbidity',        short: 'Turb', unit: 'NTU',     slot: 'chemistry', hue: '#c98500', dec: 2, plausible: [0, 1000]},
};
const VAR_KEYS = Object.keys(VARS);

const SLOTS = [
  {id: 'seafloor',  n: 1, name: 'Seafloor',               domain: 'Geological', files: ['bathymetry.asc'],
   what: 'Elevation grid. Slope and local relief are computed from it.'},
  {id: 'physics',   n: 2, name: 'Water-column physics',   domain: 'Physical',   files: ['profiles.csv'], vars: ['temperature_c', 'salinity_psu'],
   what: 'Temperature and salinity by depth. Mixed layer and thermocline are computed.'},
  {id: 'chemistry', n: 3, name: 'Water-column chemistry', domain: 'Chemical',   files: ['profiles.csv'], vars: ['oxygen_umol_kg', 'chlorophyll_mg_m3', 'turbidity_ntu'],
   what: 'Oxygen, chlorophyll and turbidity by depth.'},
  {id: 'currents',  n: 4, name: 'Currents',               domain: 'Physical',   files: ['currents.csv'],
   what: 'Eastward and northward velocity by depth.'},
  {id: 'biology',   n: 5, name: 'Biology',                domain: 'Biological', files: ['biology.csv'],
   what: 'Taxa found in each sample. Richness and diversity are computed.'},
  {id: 'stations',  n: 6, name: 'Stations and track',     domain: 'Context',    files: ['stations.csv', 'track.csv'],
   what: 'Where and when each cast, sample and dive happened, and the ship track.'},
];
const SLOT_BY_ID = Object.fromEntries(SLOTS.map(s => [s.id, s]));

const STATUS = {
  measured:   {label: 'Measured',  tone: 'good', hint: 'Recorded by an instrument or a lab at this location.'},
  'stand-in': {label: 'Stand-in',  tone: 'warn', hint: 'Real data from a public source, used until the survey\'s own data is available.'},
  modelled:   {label: 'Modelled',  tone: 'warn', hint: 'Output of a model or reanalysis, not a direct measurement.'},
  synthetic:  {label: 'Synthetic', tone: 'crit', hint: 'Generated numbers for testing. Not real data.'},
  empty:      {label: 'Empty',     tone: 'none', hint: 'No file for this slot in this location.'},
  unlabelled: {label: 'No source', tone: 'warn', hint: 'The file is there, but dataset.json does not say where it came from.'},
};
const FLAGS = ['measured', 'extended', 'modelled'];

const FILES = [
  {name: 'dataset.json', required: true, slot: null, kind: 'json',
   purpose: 'Names the location and says where each slot\'s data came from.',
   keys: [
     ['name', 'text', true, 'Name shown in the location menu, e.g. "Dampier Strait survey".'],
     ['region', 'text', false, 'Where it is, in words.'],
     ['period', '{start, end}', false, 'Survey dates as YYYY-MM-DD.'],
     ['description', 'text', false, 'One or two sentences about the survey.'],
     ['slots', 'object', false, 'For each slot id (seafloor, physics, chemistry, currents, biology, stations): status, source, note. Status is one of measured, stand-in, modelled, synthetic, empty.'],
     ['stories', 'list', false, 'Optional guided views: title, text, show (slot ids), variable, surface {variable, value}, select (station ids), depth_window (m), camera {az, el, zoom, focus [lon, lat]}.'],
   ]},
  {name: 'bathymetry.asc', required: true, slot: 'seafloor', kind: 'grid',
   purpose: 'Seafloor grid in Esri ASCII raster format, the text format GEBCO\'s download tool exports. Longitude and latitude in WGS84 degrees, elevation in metres, negative below sea level. Any single .asc file in the folder is accepted.',
   keys: [
     ['ncols, nrows', 'number', true, 'Grid size.'],
     ['xllcorner, yllcorner', 'degrees', true, 'South-west corner (xllcenter, yllcenter also accepted).'],
     ['cellsize', 'degrees', true, 'Grid spacing.'],
     ['NODATA_value', 'number', false, 'Value that marks missing cells.'],
   ]},
  {name: 'stations.csv', required: true, slot: 'stations', kind: 'table',
   purpose: 'One row for every place something was measured or sampled.',
   columns: [
     {n: 'station_id', t: 'text', req: true, d: 'Unique name of the cast, sample or dive.', alias: ['station', 'cast', 'cast_id']},
     {n: 'type', t: 'text', req: true, d: 'CTD, ROV, XBT, eDNA, water, net, camera, dive, model or other.'},
     {n: 'time_utc', t: 'time', d: 'ISO 8601 in UTC, e.g. 2026-04-28T20:47Z.', alias: ['time', 'datetime', 'date', 'eventdate']},
     {n: 'lat', t: 'num', req: true, unit: 'degrees north', min: -90, max: 90, d: 'Decimal degrees, WGS84.', alias: ['latitude', 'decimallatitude']},
     {n: 'lon', t: 'num', req: true, unit: 'degrees east', min: -180, max: 360, d: 'Decimal degrees, WGS84.', alias: ['longitude', 'decimallongitude', 'long', 'lng']},
     {n: 'label', t: 'text', d: 'Short note shown on hover.', alias: ['note', 'notes', 'description']},
   ]},
  {name: 'profiles.csv', required: false, slot: 'physics + chemistry', kind: 'table',
   purpose: 'One row per station and depth. Leave a cell blank when that variable was not measured.',
   columns: [
     {n: 'station_id', t: 'text', req: true, d: 'Must match a row in stations.csv.', alias: ['station', 'cast', 'cast_id']},
     {n: 'depth_m', t: 'num', req: true, unit: 'm', d: 'Depth below the surface, positive down.', alias: ['depth', 'depth_meters', 'pressure_dbar']},
     {n: 'temperature_c', t: 'num', unit: '°C', d: 'Slot 2. In-situ temperature.', alias: ['temperature', 'temp', 'temp_c']},
     {n: 'salinity_psu', t: 'num', unit: 'PSU', d: 'Slot 2. Practical salinity.', alias: ['salinity', 'psal', 'sal']},
     {n: 'oxygen_umol_kg', t: 'num', unit: 'µmol/kg', d: 'Slot 3. Dissolved oxygen.', alias: ['oxygen', 'doxy']},
     {n: 'chlorophyll_mg_m3', t: 'num', unit: 'mg/m³', d: 'Slot 3. Chlorophyll from fluorescence.', alias: ['chlorophyll', 'chla', 'chl', 'fluorescence']},
     {n: 'turbidity_ntu', t: 'num', unit: 'NTU', d: 'Slot 3. Turbidity.', alias: ['turbidity']},
     {n: 'flag', t: 'text', d: 'measured, extended or modelled. Blank counts as measured.'},
   ]},
  {name: 'currents.csv', required: false, slot: 'currents', kind: 'table',
   purpose: 'One row per position and depth, from a ship ADCP or a model grid.',
   columns: [
     {n: 'time_utc', t: 'time', d: 'ISO 8601 in UTC.', alias: ['time', 'datetime', 'date']},
     {n: 'lat', t: 'num', req: true, unit: 'degrees north', min: -90, max: 90, d: 'Decimal degrees, WGS84.', alias: ['latitude']},
     {n: 'lon', t: 'num', req: true, unit: 'degrees east', min: -180, max: 360, d: 'Decimal degrees, WGS84.', alias: ['longitude', 'long', 'lng']},
     {n: 'depth_m', t: 'num', req: true, unit: 'm', d: 'Depth of the measurement, positive down.', alias: ['depth']},
     {n: 'u_m_s', t: 'num', req: true, unit: 'm/s', d: 'Velocity toward the east.', alias: ['u', 'uo', 'eastward_velocity']},
     {n: 'v_m_s', t: 'num', req: true, unit: 'm/s', d: 'Velocity toward the north.', alias: ['v', 'vo', 'northward_velocity']},
   ]},
  {name: 'biology.csv', required: false, slot: 'biology', kind: 'table',
   purpose: 'One row per taxon found in a sample: eDNA reads, survey counts, or presence records such as OBIS occurrences.',
   columns: [
     {n: 'sample_id', t: 'text', req: true, d: 'Name of the sample or survey.', alias: ['sample', 'eventid']},
     {n: 'station_id', t: 'text', d: 'Station in stations.csv, if the sample was taken at one.', alias: ['station']},
     {n: 'lat', t: 'num', unit: 'degrees north', min: -90, max: 90, d: 'Needed unless station_id is given.', alias: ['latitude', 'decimallatitude']},
     {n: 'lon', t: 'num', unit: 'degrees east', min: -180, max: 360, d: 'Needed unless station_id is given.', alias: ['longitude', 'decimallongitude', 'long', 'lng']},
     {n: 'depth_m', t: 'num', unit: 'm', d: 'Sampling depth, positive down. Blank counts as surface.', alias: ['depth', 'minimumdepthinmeters']},
     {n: 'time_utc', t: 'time', d: 'ISO 8601 in UTC.', alias: ['time', 'datetime', 'date', 'eventdate']},
     {n: 'method', t: 'text', d: 'eDNA, visual survey, ROV video, OBIS record, net.'},
     {n: 'scientific_name', t: 'text', req: true, d: 'Taxon name at the rank you identified.', alias: ['scientificname', 'taxon', 'species']},
     {n: 'taxon_group', t: 'text', d: 'Broad group used for colour and summaries, e.g. Corals, Fishes.', alias: ['group', 'phylum', 'class']},
     {n: 'value', t: 'num', d: 'Reads, count or percent cover. Blank counts as present.', alias: ['reads', 'count', 'abundance', 'individualcount', 'organismquantity']},
     {n: 'value_type', t: 'text', d: 'reads, count, cover_pct or presence.'},
   ]},
  {name: 'track.csv', required: false, slot: 'stations', kind: 'table',
   purpose: 'Ship positions in time order.',
   columns: [
     {n: 'time_utc', t: 'time', d: 'ISO 8601 in UTC.', alias: ['time', 'datetime', 'date']},
     {n: 'lat', t: 'num', req: true, unit: 'degrees north', min: -90, max: 90, d: 'Decimal degrees, WGS84.', alias: ['latitude']},
     {n: 'lon', t: 'num', req: true, unit: 'degrees east', min: -180, max: 360, d: 'Decimal degrees, WGS84.', alias: ['longitude', 'long', 'lng']},
   ]},
];
const FILE_BY_NAME = Object.fromEntries(FILES.map(f => [f.name, f]));

/* ---------- small helpers ---------------------------------------------------------- */
const fmt = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v)) ? '–' : Number(v).toLocaleString('en-US', {minimumFractionDigits: d, maximumFractionDigits: d});
const fmtInt = v => fmt(v, 0);
const plural = (n, w, ws) => `${fmtInt(n)} ${n === 1 ? w : (ws || w + 's')}`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
function parseTime(s) {
  if (!s) return NaN;
  let t = String(s).trim().replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(t)) t += 'Z';
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? NaN : ms;
}
const fmtTime = ms => Number.isNaN(ms) || ms == null ? '–' : new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
const fmtLat = v => `${Math.abs(v).toFixed(3)}°${v >= 0 ? 'N' : 'S'}`;
const fmtLon = v => { const w = ((v + 540) % 360) - 180; return `${Math.abs(w).toFixed(3)}°${w >= 0 ? 'E' : 'W'}`; };
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compass = deg => COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];

/* ---------- CSV -------------------------------------------------------------------- */
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const nl = text.indexOf('\n'), first = nl < 0 ? text : text.slice(0, nl);
  const delim = [',', ';', '\t'].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cur = '', q = false;
  const push = () => { row.push(cur); cur = ''; if (row.length > 1 || row[0].trim() !== '') rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n') push();
    else if (c !== '\r') cur += c;
  }
  if (cur !== '' || row.length) push();
  return {rows, delim};
}

/* Read a table against its locked column list. Returns typed rows, or null on a blocking error. */
function readTable(text, spec, msgs) {
  const {rows: raw, delim} = parseCSV(text);
  if (raw.length < 1) { msgs.push({level: 'error', text: 'The file is empty.'}); return null; }
  const hdr = raw[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const idx = {};
  for (const c of spec.columns) {
    let i = hdr.indexOf(c.n);
    if (i < 0 && c.alias) for (const a of c.alias) {
      i = hdr.indexOf(a);
      if (i >= 0) { msgs.push({level: 'warn', text: `Column "${raw[0][i].trim()}" was read as ${c.n}${c.unit && c.t === 'num' ? `. Check that it is in ${c.unit}` : ''}.`}); break; }
    }
    if (i >= 0) idx[c.n] = i;
  }
  const missing = spec.columns.filter(c => c.req && !(c.n in idx)).map(c => c.n);
  if (missing.length) {
    msgs.push({level: 'error', text: `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Found: ${hdr.filter(Boolean).join(', ') || 'no header row'}.`});
    return null;
  }
  const used = new Set(Object.values(idx));
  const extra = hdr.filter((h, i) => !used.has(i) && h !== '');
  if (extra.length) msgs.push({level: 'warn', text: `Ignored ${plural(extra.length, 'column')} outside the locked list: ${extra.slice(0, 6).join(', ')}${extra.length > 6 ? '…' : ''}.`});
  const decComma = delim === ';' && raw.slice(1, 40).some(r => r.some(v => /^-?\d+,\d+$/.test(v.trim())));
  if (decComma) msgs.push({level: 'info', text: 'Semicolon-separated file with decimal commas: read as numbers.'});
  const out = [], bad = {};
  for (let r = 1; r < raw.length; r++) {
    const o = {}; let ok = true;
    for (const c of spec.columns) {
      const i = idx[c.n]; const v = i === undefined ? '' : (raw[r][i] ?? '').trim();
      if (c.t === 'num') {
        let x = v === '' ? NaN : Number(decComma ? v.replace(',', '.') : v);
        if (!Number.isNaN(x) && ((c.min !== undefined && x < c.min) || (c.max !== undefined && x > c.max))) { bad[`${c.n} is outside ${c.min} to ${c.max}`] = (bad[`${c.n} is outside ${c.min} to ${c.max}`] || 0) + 1; x = NaN; if (c.req) ok = false; }
        else if (Number.isNaN(x) && c.req) { ok = false; const k = `${c.n} is ${v === '' ? 'blank' : 'not a number'}`; bad[k] = (bad[k] || 0) + 1; }
        else if (Number.isNaN(x) && v !== '') { const k = `${c.n} is not a number (cell left blank)`; bad[k] = (bad[k] || 0) + 1; }
        o[c.n] = x;
      } else if (c.t === 'time') { o[c.n] = parseTime(v); }
      else { if (v === '' && c.req) { ok = false; const k = `${c.n} is blank`; bad[k] = (bad[k] || 0) + 1; } o[c.n] = v; }
    }
    if (ok) out.push(o);
  }
  for (const k in bad) msgs.push({level: 'warn', text: `${plural(bad[k], 'row')}: ${k}${/blank\)$/.test(k) ? '' : '; skipped'}.`});
  out.has = Object.fromEntries(spec.columns.map(c => [c.n, c.n in idx]));
  return out;
}

/* ---------- Esri ASCII grid -------------------------------------------------------- */
function parseASC(text, msgs) {
  const head = {}; let pos = 0;
  const re = /^\s*([A-Za-z_]+)\s+(-?[\d.eE+-]+)\s*$/;
  for (let k = 0; k < 12; k++) {
    const nl = text.indexOf('\n', pos); const line = text.slice(pos, nl < 0 ? text.length : nl).replace('\r', '');
    const m = re.exec(line); if (!m) break;
    head[m[1].toLowerCase()] = Number(m[2]); pos = nl < 0 ? text.length : nl + 1;
  }
  const ncols = head.ncols, nrows = head.nrows, dx = head.cellsize ?? head.dx, dy = head.dy ?? head.cellsize ?? head.dx;
  if (!(ncols > 1 && nrows > 1 && dx > 0)) { msgs.push({level: 'error', text: 'Not an Esri ASCII grid: the header needs ncols, nrows, xllcorner, yllcorner and cellsize.'}); return null; }
  const lon0 = head.xllcenter ?? (head.xllcorner + dx / 2), lat0 = head.yllcenter ?? (head.yllcorner + dy / 2);
  if (!Number.isFinite(lon0) || !Number.isFinite(lat0)) { msgs.push({level: 'error', text: 'The grid header has no xllcorner / yllcorner.'}); return null; }
  if (ncols * nrows > 9e6) { msgs.push({level: 'error', text: `The grid has ${fmtInt(ncols * nrows)} cells. Export a smaller area or a coarser grid (up to 9 million cells).`}); return null; }
  const nodata = head.nodata_value ?? -9999;
  const data = new Float32Array(ncols * nrows); let k = 0, i = pos; const n = text.length; let min = Infinity, max = -Infinity;
  while (i < n && k < data.length) {
    if (text.charCodeAt(i) <= 32) { i++; continue; }
    let j = i + 1; while (j < n && text.charCodeAt(j) > 32) j++;
    const v = Number(text.slice(i, j)); const row = (k / ncols) | 0, col = k - row * ncols;
    const bad = v === nodata || Number.isNaN(v);
    data[(nrows - 1 - row) * ncols + col] = bad ? NaN : v;        // stored south to north
    if (!bad) { if (v < min) min = v; if (v > max) max = v; }
    k++; i = j;
  }
  if (k < data.length) { msgs.push({level: 'error', text: `The grid header promises ${fmtInt(data.length)} values, but the file holds ${fmtInt(k)}.`}); return null; }
  if (!(min < 0)) msgs.push({level: 'warn', text: 'No cell is below sea level. Elevation must be in metres, negative below sea level.'});
  if (lon0 < -180 || lon0 > 360 || lat0 < -90 || lat0 > 90) msgs.push({level: 'warn', text: 'The grid corner is not in degrees. Export the grid in WGS84 longitude and latitude.'});
  return {ncols, nrows, lon0, lat0, dx, dy, data, min, max, lon1: lon0 + dx * (ncols - 1), lat1: lat0 + dy * (nrows - 1)};
}
function gridAt(g, lon, lat) {                 // elevation in metres at a point (bilinear), NaN outside
  const fx = (lon - g.lon0) / g.dx, fy = (lat - g.lat0) / g.dy;
  if (fx < 0 || fy < 0 || fx > g.ncols - 1 || fy > g.nrows - 1) return NaN;
  const i = Math.min(fx | 0, g.ncols - 2), j = Math.min(fy | 0, g.nrows - 2), a = fx - i, b = fy - j, d = g.data, w = g.ncols;
  const v00 = d[j * w + i], v10 = d[j * w + i + 1], v01 = d[(j + 1) * w + i], v11 = d[(j + 1) * w + i + 1];
  const v = v00 * (1 - a) * (1 - b) + v10 * a * (1 - b) + v01 * (1 - a) * b + v11 * a * b;
  return Number.isNaN(v) ? [v00, v10, v01, v11].find(x => !Number.isNaN(x)) ?? NaN : v;
}
function gridSlope(g, lon, lat) {              // slope in degrees and relief (m) in the 3x3 cells around a point
  const i = Math.max(1, Math.min(g.ncols - 2, Math.round((lon - g.lon0) / g.dx))), j = Math.max(1, Math.min(g.nrows - 2, Math.round((lat - g.lat0) / g.dy)));
  const d = g.data, w = g.ncols, mx = 111320 * Math.cos(lat * Math.PI / 180) * g.dx, my = 110570 * g.dy;
  const gx = (d[j * w + i + 1] - d[j * w + i - 1]) / (2 * mx), gy = (d[(j + 1) * w + i] - d[(j - 1) * w + i]) / (2 * my);
  let lo = Infinity, hi = -Infinity;
  for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const v = d[(j + b) * w + i + a]; if (v < lo) lo = v; if (v > hi) hi = v; }
  return {slope: Math.atan(Math.hypot(gx, gy)) * 180 / Math.PI, relief: hi - lo};
}

/* ---------- profile maths ---------------------------------------------------------- */
function interpAt(dep, val, z) {               // value at depth z (linear), NaN if not bracketed
  let pi = -1;
  for (let i = 0; i < dep.length; i++) {
    if (Number.isNaN(val[i])) continue;
    if (dep[i] >= z) { if (pi < 0) return dep[i] - z <= 6 ? val[i] : NaN; const f = (z - dep[pi]) / (dep[i] - dep[pi] || 1); return val[pi] + (val[i] - val[pi]) * f; }
    pi = i;
  }
  return NaN;
}
function crossDepth(dep, val, target, flag) {  // first depth where val crosses target, measured rows only
  let pi = -1;
  for (let i = 0; i < dep.length; i++) {
    if (Number.isNaN(val[i]) || (flag && flag[i] === 1)) continue;
    if (pi >= 0) { const a = val[pi] - target, b = val[i] - target; if (a === 0) return dep[pi]; if (a * b < 0) return dep[pi] + (dep[i] - dep[pi]) * (a / (a - b)); }
    pi = i;
  }
  return NaN;
}
function stationMetrics(p) {
  const m = {}; const d = p.depth, F = p.flag;
  const T = p.vars.temperature_c, Sa = p.vars.salinity_psu, O = p.vars.oxygen_umol_kg, C = p.vars.chlorophyll_mg_m3;
  const meas = i => F[i] !== 1;
  if (T) {
    for (let i = 0; i < d.length; i++) if (!Number.isNaN(T[i]) && meas(i)) { if (d[i] <= 15) m.sst = T[i]; break; }
    const t10 = interpAt(d, T, 10);
    if (!Number.isNaN(t10)) { let pi = -1; for (let i = 0; i < d.length; i++) { if (Number.isNaN(T[i]) || d[i] < 10 || !meas(i)) continue; if (T[i] <= t10 - 0.5) { m.mld = pi < 0 ? d[i] : d[pi] + (d[i] - d[pi]) * ((T[pi] - (t10 - 0.5)) / ((T[pi] - T[i]) || 1)); break; } pi = i; } }
    let best = 0, pi = -1;
    for (let i = 0; i < d.length; i++) { if (Number.isNaN(T[i]) || !meas(i)) continue; if (pi >= 0 && d[i] <= 400 && d[i] > d[pi]) { const g = (T[pi] - T[i]) / (d[i] - d[pi]); if (g > best) { best = g; m.tcline = (d[i] + d[pi]) / 2; m.tgrad = g; } } pi = i; }
  }
  if (Sa) { let b = -Infinity; for (let i = 0; i < d.length; i++) if (!Number.isNaN(Sa[i]) && meas(i) && d[i] <= 300 && Sa[i] > b) { b = Sa[i]; m.smax = b; m.smaxd = d[i]; } }
  if (O) { let b = Infinity; for (let i = 0; i < d.length; i++) if (!Number.isNaN(O[i]) && meas(i) && O[i] < b) { b = O[i]; m.o2min = b; m.o2mind = d[i]; } }
  if (C) { let b = -Infinity; for (let i = 0; i < d.length; i++) if (!Number.isNaN(C[i]) && meas(i) && C[i] > b) { b = C[i]; m.chlmax = b; m.chlmaxd = d[i]; } }
  let mt = NaN; for (let i = 0; i < d.length; i++) if (meas(i)) mt = d[i]; m.measuredTo = mt;
  return m;
}

/* ---------- build one dataset from a set of files ---------------------------------- */
/* files: Map(lower-case base name -> text). Returns {ds, report}. ds is null when a blocking error exists. */
function buildDataset(files, fallbackName) {
  const report = {items: [], nErr: 0, nWarn: 0};
  const item = name => { const it = {file: name, slot: FILE_BY_NAME[name] ? FILE_BY_NAME[name].slot : null, state: 'ok', summary: '', msgs: []}; report.items.push(it); return it; };
  const get = name => files.get(name);

  // -- dataset.json
  let meta = {}; const mi = item('dataset.json');
  if (get('dataset.json') === undefined) { mi.state = 'missing'; mi.msgs.push({level: 'error', text: 'dataset.json is missing. It names the location and the source of each slot.'}); }
  else {
    try { meta = JSON.parse(get('dataset.json').replace(/^﻿/, '')); if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('not an object'); }
    catch (e) { meta = {}; mi.msgs.push({level: 'error', text: `dataset.json is not valid JSON (${e.message}).`}); }
    if (!meta.name) { mi.msgs.push({level: 'warn', text: `No "name" given; using "${fallbackName}".`}); }
    if (meta.selaras_format && meta.selaras_format > FORMAT_VERSION) mi.msgs.push({level: 'warn', text: `Written for format ${meta.selaras_format}; this app reads format ${FORMAT_VERSION}.`});
    for (const k in (meta.slots || {})) {
      if (!SLOT_BY_ID[k]) mi.msgs.push({level: 'warn', text: `Unknown slot "${k}" ignored. The locked slots are ${SLOTS.map(s => s.id).join(', ')}.`});
      else if (meta.slots[k].status && !STATUS[meta.slots[k].status]) mi.msgs.push({level: 'warn', text: `Slot ${k}: status "${meta.slots[k].status}" is not one of measured, stand-in, modelled, synthetic, empty.`});
    }
    mi.summary = meta.name || fallbackName;
  }

  // -- bathymetry
  let grid = null; const bi = item('bathymetry.asc');
  let bkey = files.has('bathymetry.asc') ? 'bathymetry.asc' : null;
  if (!bkey) { const asc = [...files.keys()].filter(k => k.endsWith('.asc')); if (asc.length === 1) { bkey = asc[0]; bi.msgs.push({level: 'info', text: `Read ${bkey} as bathymetry.asc.`}); } else if (asc.length > 1) bi.msgs.push({level: 'error', text: `Found ${asc.length} .asc files. Keep one, or name the seafloor grid bathymetry.asc.`}); }
  if (!bkey) { bi.state = 'missing'; if (!bi.msgs.length) bi.msgs.push({level: 'error', text: 'bathymetry.asc is missing. Every location needs a seafloor grid.'}); }
  else { grid = parseASC(get(bkey), bi.msgs); if (grid) bi.summary = `${fmtInt(grid.ncols)} × ${fmtInt(grid.nrows)} cells, ${fmtInt(grid.min)} to ${fmtInt(grid.max)} m`; }

  // -- tables
  const table = name => {
    const it = item(name), spec = FILE_BY_NAME[name];
    if (get(name) === undefined) { it.state = spec.required ? 'missing' : 'absent'; if (spec.required) it.msgs.push({level: 'error', text: `${name} is missing.`}); return {it, rows: null}; }
    const rows = readTable(get(name), spec, it.msgs);
    if (rows) it.summary = plural(rows.length, 'row');
    return {it, rows};
  };
  const tS = table('stations.csv'), tP = table('profiles.csv'), tC = table('currents.csv'), tB = table('biology.csv'), tT = table('track.csv');

  // -- anything else in the folder
  const known = new Set([...FILES.map(f => f.name), bkey]);
  for (const k of files.keys()) if (!known.has(k)) report.items.push({file: k, slot: null, state: 'ignored', summary: '', msgs: [{level: 'info', text: 'Not part of the locked file list; ignored.'}]});

  // -- stations
  const stations = [], byId = new Map();
  if (tS.rows) {
    let dup = 0;
    for (const r of tS.rows) {
      if (byId.has(r.station_id)) { dup++; continue; }
      const s = {id: r.station_id, type: r.type || 'other', time: r.time_utc, lat: r.lat, lon: r.lon, label: r.label || '', prof: null, metrics: {}};
      stations.push(s); byId.set(s.id, s);
    }
    if (dup) tS.it.msgs.push({level: 'warn', text: `${plural(dup, 'row')} repeat a station_id; the first one is kept.`});
    if (!stations.length) tS.it.msgs.push({level: 'error', text: 'No usable station rows.'});
    if (grid) { const out = stations.filter(s => Number.isNaN(gridAt(grid, s.lon, s.lat))); if (out.length) tS.it.msgs.push({level: 'warn', text: `${plural(out.length, 'station')} outside the seafloor grid (${out.slice(0, 3).map(s => s.id).join(', ')}${out.length > 3 ? '…' : ''}). Export a larger grid to cover them.`}); }
  }

  // -- profiles
  const varsPresent = [];
  if (tP.rows && tS.rows) {
    const groups = new Map(), unknown = new Set(); let neg = 0, kept = 0, badFlag = 0;
    for (const r of tP.rows) { if (!byId.has(r.station_id)) { unknown.add(r.station_id); continue; } kept++; if (r.depth_m < 0) neg++; let g = groups.get(r.station_id); if (!g) groups.set(r.station_id, g = []); g.push(r); }
    if (unknown.size) tP.it.msgs.push({level: 'warn', text: `Rows for ${plural(unknown.size, 'station')} not listed in stations.csv were skipped (${[...unknown].slice(0, 3).join(', ')}${unknown.size > 3 ? '…' : ''}).`});
    const flip = neg > 0 && neg >= kept * 0.9;
    if (flip) tP.it.msgs.push({level: 'warn', text: 'depth_m is negative; read as positive down.'});
    else if (neg) tP.it.msgs.push({level: 'warn', text: `${plural(neg, 'row')} with negative depth_m were skipped.`});
    for (const [id, g] of groups) {
      const rows = g.filter(r => flip || r.depth_m >= 0).sort((a, b) => Math.abs(a.depth_m) - Math.abs(b.depth_m)); if (!rows.length) continue;
      const p = {depth: Float32Array.from(rows, r => Math.abs(r.depth_m)), flag: new Uint8Array(rows.length), vars: {}};
      rows.forEach((r, i) => { const f = (r.flag || '').toLowerCase(); const k = f === '' ? 0 : FLAGS.indexOf(f); if (k < 0) badFlag++; p.flag[i] = k < 0 ? 0 : k; });
      for (const v of VAR_KEYS) { const arr = Float32Array.from(rows, r => r[v]); if (arr.some(x => !Number.isNaN(x))) p.vars[v] = arr; }
      if (Object.keys(p.vars).length) { byId.get(id).prof = p; byId.get(id).metrics = stationMetrics(p); }
    }
    if (badFlag) tP.it.msgs.push({level: 'warn', text: `${plural(badFlag, 'row')} have a flag other than measured, extended or modelled; treated as measured.`});
    for (const v of VAR_KEYS) {
      let n = 0, odd = 0; const [lo, hi] = VARS[v].plausible;
      for (const s of stations) if (s.prof && s.prof.vars[v]) { n++; for (const x of s.prof.vars[v]) if (x < lo || x > hi) odd++; }
      if (n) varsPresent.push(v);
      if (odd) tP.it.msgs.push({level: 'warn', text: `${plural(odd, 'value')} of ${v} outside ${lo} to ${hi} ${VARS[v].unit}. Check the units.`});
    }
    const nCast = stations.filter(s => s.prof).length;
    tP.it.summary = `${plural(tP.rows.length, 'row')}, ${plural(nCast, 'cast')}: ${varsPresent.map(v => VARS[v].label.toLowerCase()).join(', ') || 'no values'}`;
  } else if (tP.rows && !tS.rows) tP.it.msgs.push({level: 'error', text: 'profiles.csv needs stations.csv to place its casts.'});

  // -- currents
  let currents = [];
  if (tC.rows) {
    currents = tC.rows.filter(r => r.depth_m >= 0 || (r.depth_m = Math.abs(r.depth_m)) >= 0).map(r => ({t: r.time_utc, lat: r.lat, lon: r.lon, depth: r.depth_m, u: r.u_m_s, v: r.v_m_s, speed: Math.hypot(r.u_m_s, r.v_m_s)}));
    const fast = currents.filter(c => c.speed > 4).length;
    if (fast) tC.it.msgs.push({level: 'warn', text: `${plural(fast, 'row')} faster than 4 m/s. Velocities must be in m/s, not cm/s.`});
  }

  // -- biology
  const samples = []; const groupsSeen = new Map();
  if (tB.rows) {
    const bySample = new Map(); let noPos = 0;
    for (const r of tB.rows) {
      let lat = r.lat, lon = r.lon; const st = r.station_id ? byId.get(r.station_id) : null;
      if ((Number.isNaN(lat) || Number.isNaN(lon)) && st) { lat = st.lat; lon = st.lon; }
      if (Number.isNaN(lat) || Number.isNaN(lon)) { noPos++; continue; }
      let s = bySample.get(r.sample_id);
      if (!s) { bySample.set(r.sample_id, s = {id: r.sample_id, stationId: st ? st.id : '', lat, lon, depth: Number.isNaN(r.depth_m) ? 0 : Math.abs(r.depth_m), time: r.time_utc, method: r.method || '', valueType: (r.value_type || '').toLowerCase(), taxa: new Map()}); samples.push(s); }
      const val = Number.isNaN(r.value) ? 1 : r.value; if (!(val > 0)) continue;
      const group = r.taxon_group || 'Ungrouped'; const t = s.taxa.get(r.scientific_name);
      if (t) t.value += val; else s.taxa.set(r.scientific_name, {name: r.scientific_name, group, value: val});
      if (!s.valueType && !Number.isNaN(r.value)) s.valueType = 'count';
    }
    if (noPos) tB.it.msgs.push({level: 'warn', text: `${plural(noPos, 'row')} skipped: no lat/lon and no matching station_id.`});
    for (const s of samples) {
      s.taxa = [...s.taxa.values()].sort((a, b) => b.value - a.value);
      s.richness = s.taxa.length; s.total = s.taxa.reduce((a, t) => a + t.value, 0);
      s.quant = s.valueType !== 'presence' && s.valueType !== '' && s.taxa.some(t => t.value !== 1);
      s.shannon = s.quant && s.total > 0 ? -s.taxa.reduce((a, t) => { const p = t.value / s.total; return a + p * Math.log(p); }, 0) : NaN;
      const gm = new Map(); for (const t of s.taxa) { gm.set(t.group, (gm.get(t.group) || 0) + 1); groupsSeen.set(t.group, (groupsSeen.get(t.group) || 0) + 1); }
      s.groups = [...gm.entries()].sort((a, b) => b[1] - a[1]);
    }
    tB.it.summary = `${plural(tB.rows.length, 'row')}, ${plural(samples.length, 'sample')}, ${plural(new Set(samples.flatMap(s => s.taxa.map(t => t.name))).size, 'taxon', 'taxa')}`;
  }

  // -- track
  let track = [];
  if (tT.rows) { track = tT.rows.map(r => ({t: r.time_utc, lat: r.lat, lon: r.lon})); if (track.every(p => !Number.isNaN(p.t))) track.sort((a, b) => a.t - b.t); }

  for (const it of report.items) {
    const e = it.msgs.filter(m => m.level === 'error').length, w = it.msgs.filter(m => m.level === 'warn').length;
    report.nErr += e; report.nWarn += w;
    if (it.state === 'ok') it.state = e ? 'error' : w ? 'warn' : 'ok';
  }
  if (report.nErr || !grid || !stations.length) return {ds: null, report};

  // -- geometry shared by every slot: local flat projection in km around the grid centre
  const lonC = (grid.lon0 + grid.lon1) / 2, latC = (grid.lat0 + grid.lat1) / 2, kx = 111.32 * Math.cos(latC * Math.PI / 180), ky = 110.57;
  const X = lon => (lon - lonC) * kx, Y = lat => (lat - latC) * ky;
  const km = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  for (const s of stations) {
    s.x = X(s.lon); s.y = Y(s.lat);
    const e = gridAt(grid, s.lon, s.lat); s.floor = Number.isNaN(e) ? NaN : -e;
    if (!Number.isNaN(e)) Object.assign(s, gridSlope(grid, s.lon, s.lat));
  }
  for (const c of currents) { c.x = X(c.lon); c.y = Y(c.lat); }
  for (const b of samples) { b.x = X(b.lon); b.y = Y(b.lat); const e = gridAt(grid, b.lon, b.lat); b.floor = Number.isNaN(e) ? NaN : -e; }
  for (const p of track) { p.x = X(p.lon); p.y = Y(p.lat); }
  const casts = stations.filter(s => s.prof);
  const nearest = (o, list) => { let best = null, bd = Infinity; for (const q of list) { if (q === o) continue; const d = km(o, q); if (d < bd) { bd = d; best = q; } } return best ? {o: best, km: bd} : null; };
  for (const s of stations) {
    s.nearBio = samples.find(b => b.stationId === s.id) ? {o: samples.find(b => b.stationId === s.id), km: 0} : nearest(s, samples);
    s.nearCast = s.prof ? {o: s, km: 0} : nearest(s, casts);
    for (const [key, slot] of [['nearPhys', 'physics'], ['nearChem', 'chemistry']]) { const hasIt = q => SLOT_BY_ID[slot].vars.some(v => q.prof.vars[v]); s[key] = s.prof && hasIt(s) ? {o: s, km: 0} : nearest(s, casts.filter(hasIt)); }
    if (currents.length) { let best = null, bd = Infinity; for (const c of currents) { const d = Math.hypot(c.x - s.x, c.y - s.y) + c.depth * 0.02; if (d < bd) { bd = d; best = c; } } s.nearCur = {o: best, km: Math.hypot(best.x - s.x, best.y - s.y)}; }
  }
  for (const b of samples) b.nearCast = nearest(b, casts);

  // -- per-slot state
  const slotMeta = meta.slots || {}; const slots = {};
  const has = {
    seafloor: true,
    physics: SLOT_BY_ID.physics.vars.some(v => varsPresent.includes(v)),
    chemistry: SLOT_BY_ID.chemistry.vars.some(v => varsPresent.includes(v)),
    currents: currents.length > 0, biology: samples.length > 0, stations: true,
  };
  const count = {
    seafloor: `${fmtInt(grid.ncols)} × ${fmtInt(grid.nrows)} grid`,
    physics: `${plural(casts.filter(s => SLOT_BY_ID.physics.vars.some(v => s.prof.vars[v])).length, 'cast')}`,
    chemistry: `${plural(casts.filter(s => SLOT_BY_ID.chemistry.vars.some(v => s.prof.vars[v])).length, 'cast')}`,
    currents: plural(currents.length, 'vector'), biology: `${plural(samples.length, 'sample')}`,
    stations: `${plural(stations.length, 'station')}${track.length ? `, ${plural(track.length, 'track point')}` : ''}`,
  };
  for (const s of SLOTS) {
    const m = slotMeta[s.id] || {}; let status = has[s.id] ? (STATUS[m.status] && m.status !== 'empty' ? m.status : 'unlabelled') : 'empty';
    slots[s.id] = {has: has[s.id], status, source: m.source || '', note: m.note || '', count: has[s.id] ? count[s.id] : ''};
  }
  let maxDepth = -grid.min; for (const s of casts) maxDepth = Math.max(maxDepth, s.prof.depth[s.prof.depth.length - 1]);
  const ds = {
    id: meta.id || fallbackName, name: meta.name || fallbackName, region: meta.region || '', period: meta.period || null, description: meta.description || '',
    stories: Array.isArray(meta.stories) ? meta.stories.filter(s => s && s.title) : [], grid, stations, byId, casts, varsPresent, currents, samples, track, slots,
    bioGroups: [...groupsSeen.entries()].sort((a, b) => b[1] - a[1]).map(g => g[0]),
    maxDepth: Math.max(50, maxDepth), lonC, latC, kx, ky, X, Y,
    halfX: (grid.lon1 - grid.lon0) / 2 * kx, halfY: (grid.lat1 - grid.lat0) / 2 * ky,
  };
  return {ds, report};
}
