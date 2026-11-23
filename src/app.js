import { makeProblem, solve } from './solver.js';
import { estimateMatrix, osrmMatrix, osrmRoute, DEFAULT_TRAVEL } from './travel.js';
import { importStops, exportStops, TEMPLATE_CSV } from './csv.js';
import { geocode, geocodeMany } from './geocode.js';
import { fmtTime, fmtDuration, parseClock, toClock, parseLatLng, escapeHtml } from './format.js';
import { buildIcs } from './ics.js';
import { itineraryRows, rowDescription, shareText } from './itinerary.js';
import { sampleDay } from './sample.js';

const STORE_KEY = 'showing-route-planner:v1';
const $ = (id) => document.getElementById(id);

function nextSaturday() {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function freshState() {
  return { ...sampleDay(), date: nextSaturday(), buyer: '', settings: { ...DEFAULT_TRAVEL, useOsrm: false, osrmUrl: '', useGeocode: false, geocodeUrl: '' } };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && Array.isArray(s.stops) && s.start) return { ...freshState(), ...s, settings: { ...freshState().settings, ...s.settings } };
    }
  } catch {
    /* private mode or corrupt data: start fresh */
  }
  return freshState();
}

let state = load();
let plan = null;
let travel = null;
let planNote = '';
let editingId = null;
let mapMode = null; // 'start' | 'pin' | null
let planSeq = 0;
let roadLine = null;
let lastFitKey = '';
let activeTab = 'stops';

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable: the app still works, it just will not remember */
  }
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

const coordText = (p) => `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
const newId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const isDesktop = () => window.matchMedia('(min-width: 960px)').matches;

/* ---------- tabs ---------- */

function showTab(tab) {
  activeTab = tab === 'map' && isDesktop() ? 'stops' : tab;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === activeTab));
  document.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('on', p.dataset.panel === activeTab));
  if (map && activeTab === 'map') {
    // The map is measured while hidden on a phone, so refit once it is on screen.
    setTimeout(() => {
      map.invalidateSize();
      fit();
    }, 60);
  } else if (map) setTimeout(() => map.invalidateSize(), 60);
}

/* ---------- map ---------- */

let map;
let layer;
let startMarker;

function initMap() {
  map = L.map('map', { zoomControl: true, attributionControl: true }).setView([state.start.lat, state.start.lng], 11);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    crossOrigin: true,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  layer = L.layerGroup().addTo(map);
  map.on('click', (e) => {
    if (mapMode === 'start') {
      state.start = { ...state.start, lat: e.latlng.lat, lng: e.latlng.lng };
      setMapMode(null);
      changed();
      toast('Start point set');
    } else if (mapMode === 'pin') {
      $('fCoords').value = coordText(e.latlng);
      setMapMode(null);
      showTab('stops');
      $('fLabel').focus();
      toast('Pin dropped. Name it and save.');
    }
  });
}

function setMapMode(mode) {
  mapMode = mode;
  $('pickStart').classList.toggle('armed', mode === 'start');
  $('pickPin').classList.toggle('armed', mode === 'pin');
  $('mapHint').textContent = mode === 'start' ? 'Tap the map to set the start' : mode === 'pin' ? 'Tap the map to drop a pin' : 'Tap a numbered pin for details';
  if (mode) showTab('map');
}

function pinIcon(text, cls) {
  return L.divIcon({ className: `pin ${cls}`, html: `<span>${text}</span>`, iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -14] });
}

function drawMap() {
  if (!map) return;
  layer.clearLayers();
  startMarker = L.marker([state.start.lat, state.start.lng], { icon: pinIcon('S', 'start'), draggable: true, title: 'Start point' }).addTo(layer);
  startMarker.bindPopup(`<b>${escapeHtml(state.start.label || 'Start')}</b><br>Leave at ${fmtTime(state.startTime)}`);
  startMarker.on('dragend', () => {
    const ll = startMarker.getLatLng();
    state.start = { ...state.start, lat: ll.lat, lng: ll.lng };
    changed();
  });
  const byId = new Map(state.stops.map((s) => [s.id, s]));
  const latlngs = [[state.start.lat, state.start.lng]];
  plan?.legs.forEach((leg, i) => {
    const s = byId.get(leg.id);
    latlngs.push([s.lat, s.lng]);
    L.marker([s.lat, s.lng], { icon: pinIcon(i + 1, s.must ? 'must' : ''), title: s.label })
      .bindPopup(`<b>${i + 1}. ${escapeHtml(s.label)}</b><br>${fmtTime(leg.start)} to ${fmtTime(leg.end)}<br>Window ${fmtTime(s.open)} to ${fmtTime(s.close)}`)
      .addTo(layer);
  });
  if (roadLine?.length) L.polyline(roadLine, { color: '#e2583a', weight: 5, opacity: 0.85 }).addTo(layer);
  else if (latlngs.length > 1) L.polyline(latlngs, { color: '#e2583a', weight: 4, opacity: 0.8, dashArray: '2 8', lineCap: 'round' }).addTo(layer);
  $('routeNote').textContent = roadLine?.length ? 'Road route from your OSRM server' : 'Straight lines between stops, not roads';
  const served = new Set(plan?.order ?? []);
  for (const s of state.stops) {
    if (served.has(s.id)) continue;
    L.marker([s.lat, s.lng], { icon: pinIcon('x', 'off'), title: `${s.label} (not scheduled)` })
      .bindPopup(`<b>${escapeHtml(s.label)}</b><br>Not scheduled. Window ${fmtTime(s.open)} to ${fmtTime(s.close)}`)
      .addTo(layer);
  }
  const key = state.stops.map((s) => s.id).join(',');
  if (key !== lastFitKey) {
    lastFitKey = key;
    fit();
  }
}

function fit() {
  if (!map) return;
  const pts = [[state.start.lat, state.start.lng], ...state.stops.map((s) => [s.lat, s.lng])];
  map.fitBounds(pts, { padding: [40, 40], maxZoom: 14 });
}

/* ---------- planning ---------- */

async function recompute() {
  const seq = ++planSeq;
  const pts = [state.start, ...state.stops];
  const cfg = state.settings;
  planNote = '';
  let tm;
  if (cfg.useOsrm && cfg.osrmUrl && state.stops.length) {
    try {
      tm = await osrmMatrix(pts, cfg.osrmUrl);
    } catch (e) {
      planNote = `Real drive times failed (${e.message}) so the offline estimate is used.`;
      tm = estimateMatrix(pts, cfg);
    }
  } else {
    tm = estimateMatrix(pts, cfg);
  }
  if (seq !== planSeq) return;
  travel = tm;
  const problem = makeProblem({
    stops: state.stops.map((s) => ({ id: s.id, label: s.label, open: s.open, close: s.close, dur: s.dur, must: s.must })),
    startTime: state.startTime,
    matrix: tm.minutes,
  });
  plan = solve(problem);
  roadLine = null;
  render();
  if (cfg.useOsrm && cfg.osrmUrl && plan.legs.length) {
    const byId = new Map(state.stops.map((x) => [x.id, x]));
    try {
      const line = await osrmRoute([state.start, ...plan.legs.map((l) => byId.get(l.id))], cfg.osrmUrl);
      if (seq !== planSeq) return;
      roadLine = line;
      drawMap();
    } catch (e) {
      if (seq === planSeq) {
        planNote = `${planNote} Road lines unavailable (${e.message})`.trim();
        renderSummary();
      }
    }
  }
}

let debounce;
function changed() {
  save();
  clearTimeout(debounce);
  debounce = setTimeout(recompute, 120);
}

/* ---------- rendering ---------- */

function miles(from, to) {
  return travel?.miles?.[from]?.[to] ?? 0;
}

function renderSummary() {
  const el = $('summary');
  if (!plan) {
    el.innerHTML = '<div class="note">Planning...</div>';
    return;
  }
  if (!state.stops.length) {
    el.innerHTML = '<div class="note">Add showings below, or load the sample day, and the plan appears here.</div>';
    return;
  }
  const bad = plan.unserved.length > 0;
  let totalMiles = 0;
  plan.legs.forEach((leg, i) => {
    const from = i === 0 ? 0 : plan.legs[i - 1].index + 1;
    totalMiles += miles(from, leg.index + 1);
  });
  const mustBad = plan.mustMissed > 0;
  const how = plan.mode === 'exact' ? 'Best possible plan (checked every order)' : 'Best plan found (large day, search heuristic)';
  const src = travel?.source === 'osrm' ? 'Drive times from your OSRM server.' : `Drive times estimated: ${state.settings.roadFactor}x straight line at ${state.settings.mph} mph.`;
  el.innerHTML = `
    <div class="tile ${bad ? 'bad' : 'good'}"><div class="lbl">Showings that fit</div><div class="big num">${plan.served} of ${plan.total}</div></div>
    <div class="tile"><div class="lbl">Driving</div><div class="big num">${fmtDuration(plan.drive)} <small>${totalMiles.toFixed(1)} mi</small></div></div>
    <div class="tile ${mustBad ? 'bad' : ''}"><div class="lbl">${plan.served ? 'Done by' : 'Must-sees missed'}</div><div class="big num">${plan.served ? fmtTime(plan.finish) : plan.mustMissed}</div></div>
    <div class="note">${how}. ${src}${planNote ? ` ${escapeHtml(planNote)}` : ''}</div>`;
}

function renderStops() {
  $('stopCount').textContent = state.stops.length ? `(${state.stops.length})` : '';
  const order = new Map((plan?.order ?? []).map((id, i) => [id, i + 1]));
  $('stopList').innerHTML = state.stops.length
    ? state.stops
        .map((s) => {
          const n = order.get(s.id);
          return `<li class="card stop" data-id="${s.id}">
            <span class="badge ${n ? '' : 'off'}">${n ?? 'x'}</span>
            <div class="meta"><div class="name">${escapeHtml(s.label)} ${s.must ? '<span class="tag">must-see</span>' : ''}</div>
            <div class="sub">${fmtTime(s.open)} to ${fmtTime(s.close)}, ${s.dur} min inside</div></div>
            <div class="acts"><button class="btn small" type="button" data-act="edit">Edit</button><button class="btn small danger" type="button" data-act="del" aria-label="Delete ${escapeHtml(s.label)}">Delete</button></div>
          </li>`;
        })
        .join('')
    : '<li class="card empty">No showings yet.</li>';
}

function renderTimeline() {
  const probs = $('problems');
  const tl = $('timeline');
  if (!plan || !state.stops.length) {
    probs.innerHTML = '';
    tl.innerHTML = '<li class="card empty">Add showings to see the route.</li>';
    return;
  }
  const byId = new Map(state.stops.map((s) => [s.id, s]));
  probs.className = 'problems';
  probs.innerHTML = plan.unserved
    .map((u) => {
      const s = byId.get(u.id);
      return `<div class="problem ${u.must ? '' : 'soft'}"><b>${u.must ? 'Must-see not scheduled' : 'Not scheduled'}: ${escapeHtml(s.label)}</b><span>${escapeHtml(u.reason.text)}</span><span>Window ${fmtTime(s.open)} to ${fmtTime(s.close)}, needs ${s.dur} min.</span></div>`;
    })
    .join('');
  const lo = Math.min(state.startTime, ...state.stops.map((s) => s.open));
  const hi = Math.max(...state.stops.map((s) => s.close));
  const pos = (m) => `${(((m - lo) / Math.max(1, hi - lo)) * 100).toFixed(2)}%`;
  const w = (a, b) => `${(((b - a) / Math.max(1, hi - lo)) * 100).toFixed(2)}%`;
  const parts = [`<li class="leg num">Leave ${escapeHtml(state.start.label || 'start')} at ${fmtTime(state.startTime)}</li>`];
  plan.legs.forEach((leg, i) => {
    const s = byId.get(leg.id);
    const from = i === 0 ? 0 : plan.legs[i - 1].index + 1;
    parts.push(`<li class="leg">${fmtDuration(leg.drive)} drive, ${miles(from, leg.index + 1).toFixed(1)} mi</li>`);
    parts.push(`<li class="card tl-stop"><span class="badge">${i + 1}</span><div class="body">
      <div class="name">${escapeHtml(s.label)} ${s.must ? '<span class="tag">must-see</span>' : ''}</div>
      <div class="times num">${fmtTime(leg.start)} to ${fmtTime(leg.end)}</div>
      <div class="gauge" title="Window ${fmtTime(s.open)} to ${fmtTime(s.close)}"><i class="win" style="left:${pos(s.open)};width:${w(s.open, s.close)}"></i><i class="at" style="left:${pos(leg.start)};width:${w(leg.start, leg.end)}"></i></div>
      <div class="chips"><span>Window ${fmtTime(s.open)} to ${fmtTime(s.close)}</span>${leg.wait ? `<span class="tag">wait ${fmtDuration(leg.wait)}</span>` : ''}<span class="tag ${leg.slack <= 10 ? '' : 'good'}">${fmtDuration(leg.slack)} to spare</span></div>
    </div></li>`);
  });
  tl.innerHTML = parts.join('');
}

function itinerary() {
  if (!plan) return { rows: [], unserved: [] };
  const rows = itineraryRows(state.stops, plan, state.start);
  const byId = new Map(state.stops.map((s) => [s.id, s]));
  const unserved = plan.unserved.map((u) => ({ label: byId.get(u.id).label, reason: u.reason.text }));
  return { rows, unserved };
}

function longDate() {
  const [y, m, d] = state.date.split('-').map(Number);
  if (!y) return state.date;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function currentShareText() {
  const { rows, unserved } = itinerary();
  return shareText({ rows, unserved, date: longDate(), buyer: state.buyer.trim(), startLabel: state.start.label });
}

function renderShare() {
  $('sharePreview').textContent = state.stops.length && plan ? currentShareText() : 'Nothing to share yet.';
  const { rows, unserved } = itinerary();
  const who = state.buyer.trim();
  $('printSheet').innerHTML = `
    <h1>${who ? `Showings for ${escapeHtml(who)}` : 'Showing itinerary'}</h1>
    <p class="sub">${escapeHtml(longDate())}. Start: ${escapeHtml(state.start.label || 'Start')} at ${fmtTime(state.startTime)}.</p>
    <table><thead><tr><th>#</th><th>Time</th><th>Home</th></tr></thead><tbody>
    ${rows
      .map(
        (r) => `<tr><td>${r.number}</td><td class="time">${fmtTime(r.start)}<br>to ${fmtTime(r.end)}</td><td><strong>${escapeHtml(r.label)}</strong>${r.drive ? `<div class="drive">${fmtDuration(r.drive)} drive from ${escapeHtml(r.from)}</div>` : ''}</td></tr>`,
      )
      .join('')}
    </tbody></table>
    ${unserved.length ? `<h2>Not scheduled</h2><ul>${unserved.map((u) => `<li>${escapeHtml(u.label)}: ${escapeHtml(u.reason)}</li>`).join('')}</ul>` : ''}
    <p class="foot">Times are estimates. Showing windows come from the listing agents and can change.</p>`;
}

function render() {
  renderSummary();
  renderStops();
  renderTimeline();
  renderShare();
  drawMap();
}

/* ---------- forms ---------- */

function syncFormFromState() {
  $('startLabel').value = state.start.label ?? '';
  $('startCoords').value = coordText(state.start);
  $('startTime').value = toClock(state.startTime);
  $('buyer').value = state.buyer;
  $('date').value = state.date;
  $('sFactor').value = state.settings.roadFactor;
  $('sMph').value = state.settings.mph;
  $('sOsrm').checked = state.settings.useOsrm;
  $('sOsrmUrl').value = state.settings.osrmUrl;
  $('sGeo').checked = state.settings.useGeocode;
  $('sGeoUrl').value = state.settings.geocodeUrl;
  updateLookupButton();
}

function geocodingOn() {
  return state.settings.useGeocode && !!state.settings.geocodeUrl;
}

function updateLookupButton() {
  $('lookupBtn').hidden = !geocodingOn();
}

function resetStopForm() {
  editingId = null;
  $('stopForm').reset();
  $('fOpen').value = '13:00';
  $('fClose').value = '14:00';
  $('fDur').value = 30;
  $('formTitle').textContent = 'Add a showing';
  $('saveStop').textContent = 'Add showing';
  $('cancelEdit').hidden = true;
  $('formErr').textContent = '';
}

function startEdit(id) {
  const s = state.stops.find((x) => x.id === id);
  if (!s) return;
  editingId = id;
  $('fLabel').value = s.label;
  $('fCoords').value = coordText(s);
  $('fOpen').value = toClock(s.open);
  $('fClose').value = toClock(s.close);
  $('fDur').value = s.dur;
  $('fMust').checked = s.must;
  $('formTitle').textContent = 'Edit showing';
  $('saveStop').textContent = 'Save changes';
  $('cancelEdit').hidden = false;
  $('stopForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function submitStop(e) {
  e.preventDefault();
  const label = $('fLabel').value.trim();
  const ll = parseLatLng($('fCoords').value);
  const open = parseClock($('fOpen').value);
  const close = parseClock($('fClose').value);
  const dur = Number($('fDur').value);
  const err = !label
    ? 'Give the showing an address label.'
    : !ll
      ? 'Coordinates should look like 35.8101, -78.6120. You can also drop a pin on the map.'
      : Number.isNaN(open) || Number.isNaN(close)
        ? 'Set both window times.'
        : close <= open
          ? 'The window has to close after it opens.'
          : !(dur >= 5 && dur <= 240)
            ? 'Minutes inside should be between 5 and 240.'
            : '';
  $('formErr').textContent = err;
  if (err) return;
  const stop = { id: editingId ?? newId(), label, lat: ll.lat, lng: ll.lng, open, close, dur, must: $('fMust').checked };
  if (editingId) state.stops = state.stops.map((s) => (s.id === editingId ? stop : s));
  else state.stops = [...state.stops, stop];
  resetStopForm();
  changed();
  toast(editingId ? 'Saved' : 'Showing added');
}

function readStart() {
  const ll = parseLatLng($('startCoords').value);
  if (ll) state.start = { ...state.start, ...ll };
  state.start.label = $('startLabel').value.trim();
  const t = parseClock($('startTime').value);
  if (!Number.isNaN(t)) state.startTime = t;
  changed();
}

function readSettings() {
  const f = Number($('sFactor').value);
  const m = Number($('sMph').value);
  state.settings = {
    roadFactor: f >= 1 && f <= 3 ? f : DEFAULT_TRAVEL.roadFactor,
    mph: m >= 5 && m <= 80 ? m : DEFAULT_TRAVEL.mph,
    useOsrm: $('sOsrm').checked,
    osrmUrl: $('sOsrmUrl').value.trim(),
    useGeocode: $('sGeo').checked,
    geocodeUrl: $('sGeoUrl').value.trim(),
  };
  updateLookupButton();
  changed();
}

/* ---------- share actions ---------- */

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadIcs() {
  const { rows } = itinerary();
  if (!rows.length) return toast('Nothing scheduled yet');
  const ics = buildIcs({
    date: state.date,
    title: state.buyer.trim() ? `Showings for ${state.buyer.trim()}` : 'Showings',
    items: rows.map((r) => ({ uid: `${state.date}-${r.id}`, label: r.label, startMin: r.start, endMin: r.end, lat: r.lat, lng: r.lng, description: rowDescription(r) })),
  });
  download(`showings-${state.date}.ics`, ics, 'text/calendar');
  toast('Calendar file saved');
}

async function shareNow() {
  if (!plan?.legs.length) return toast('Nothing scheduled yet');
  const text = currentShareText();
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Showing plan', text });
      return;
    }
    await navigator.clipboard.writeText(text);
    toast('Copied to the clipboard');
  } catch (e) {
    if (e?.name !== 'AbortError') toast('Could not share. Select the preview text and copy it.');
  }
}

/* ---------- csv and address lookup ---------- */

function showCsvStatus(msg, skipped = []) {
  const items = skipped.map((k) => `<li>Row ${k.row}${k.label ? ` (${escapeHtml(k.label)})` : ''}: ${escapeHtml(k.reason)}</li>`).join('');
  $('csvStatus').innerHTML = `<p>${escapeHtml(msg)}</p>${items ? `<ul>${items}</ul>` : ''}`;
}

async function importCsvText(text) {
  const r = importStops(text, () => newId());
  const added = [...r.stops];
  const skipped = [...r.skipped];
  if (r.pending.length && geocodingOn()) {
    showCsvStatus(`Looking up ${r.pending.length} addresses, about one per second...`);
    const found = await geocodeMany(
      state.settings.geocodeUrl,
      r.pending.map((p) => p.label),
      { onProgress: (i, n) => showCsvStatus(`Looking up addresses: ${i} of ${n}`) },
    );
    r.pending.forEach((p, i) => {
      if (found[i].ok) added.push({ ...p, lat: found[i].lat, lng: found[i].lng });
      else skipped.push({ row: p.row, label: p.label, reason: found[i].error });
    });
  } else {
    for (const p of r.pending) skipped.push({ row: p.row, label: p.label, reason: 'No coordinates. Add lat and lng columns, or turn on address lookup under Travel time settings.' });
  }
  if (added.length) {
    state.stops = [...state.stops, ...added.map((a) => ({ ...a, row: undefined }))];
    changed();
  }
  showCsvStatus(`Imported ${added.length} of ${r.total} rows.${skipped.length ? ` Skipped ${skipped.length}:` : ''}`, skipped);
}

async function lookupAddress() {
  const btn = $('lookupBtn');
  btn.disabled = true;
  try {
    const hit = await geocode(state.settings.geocodeUrl, $('fLabel').value);
    $('fCoords').value = coordText(hit);
    toast(hit.name ? `Found: ${hit.name.slice(0, 60)}` : 'Coordinates filled in');
  } catch (e) {
    $('formErr').textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}

/* ---------- wiring ---------- */

function wire() {
  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b) showTab(b.dataset.tab);
  });
  $('stopForm').addEventListener('submit', submitStop);
  $('cancelEdit').addEventListener('click', resetStopForm);
  $('pickPin').addEventListener('click', () => setMapMode(mapMode === 'pin' ? null : 'pin'));
  $('pickStart').addEventListener('click', () => setMapMode(mapMode === 'start' ? null : 'start'));
  $('fitBtn').addEventListener('click', fit);
  $('stopList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const id = b.closest('[data-id]').dataset.id;
    if (b.dataset.act === 'edit') startEdit(id);
    else {
      state.stops = state.stops.filter((s) => s.id !== id);
      if (editingId === id) resetStopForm();
      changed();
    }
  });
  for (const id of ['startLabel', 'startCoords', 'startTime']) $(id).addEventListener('change', readStart);
  for (const id of ['sFactor', 'sMph', 'sOsrm', 'sOsrmUrl', 'sGeo', 'sGeoUrl']) $(id).addEventListener('change', readSettings);
  $('buyer').addEventListener('input', () => {
    state.buyer = $('buyer').value;
    save();
    renderShare();
  });
  $('date').addEventListener('change', () => {
    if ($('date').value) state.date = $('date').value;
    save();
    renderShare();
  });
  $('loadSample').addEventListener('click', () => {
    const keep = { date: state.date, buyer: state.buyer, settings: state.settings };
    state = { ...sampleDay(), ...keep };
    resetStopForm();
    syncFormFromState();
    lastFitKey = '';
    changed();
    toast('Sample day loaded');
  });
  $('clearAll').addEventListener('click', () => {
    state.stops = [];
    resetStopForm();
    changed();
  });
  $('printBtn').addEventListener('click', () => {
    if (!plan?.legs.length) return toast('Nothing scheduled yet');
    renderShare();
    window.print();
  });
  $('csvFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 1_000_000) return showCsvStatus('That file is over 1 MB. Split it up.');
    await importCsvText(await file.text());
  });
  $('csvExport').addEventListener('click', () => {
    if (!state.stops.length) return toast('No showings to export');
    download('showings.csv', exportStops(state.stops), 'text/csv');
  });
  $('csvTemplate').addEventListener('click', () => download('showings-template.csv', TEMPLATE_CSV, 'text/csv'));
  $('lookupBtn').addEventListener('click', lookupAddress);
  $('icsBtn').addEventListener('click', downloadIcs);
  $('shareBtn').addEventListener('click', shareNow);

  const net = () => {
    $('netChip').textContent = navigator.onLine ? 'Online' : 'Offline';
    $('netChip').classList.toggle('off', !navigator.onLine);
  };
  window.addEventListener('online', net);
  window.addEventListener('offline', net);
  net();
  window.addEventListener('resize', () => showTab(activeTab));

  let deferred;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    $('installBtn').hidden = false;
  });
  $('installBtn').addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    $('installBtn').hidden = true;
  });
}

function boot() {
  wire();
  syncFormFromState();
  initMap();
  showTab('stops');
  render();
  recompute();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot();
