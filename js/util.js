// Small DOM and formatting helpers shared by every view.

export const nodes = children =>
  children.flat(Infinity).filter(c => c != null && c !== false && c !== '');

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key in el) el[key] = value;
    else el.setAttribute(key, value);
  }
  el.append(...nodes(children));
  return el;
}

export function mount(el, ...children) {
  el.replaceChildren(...nodes(children));
  return el;
}

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

const pad = n => String(n).padStart(2, '0');

// Dates are stored as local YYYY-MM-DD strings, never as UTC timestamps.
export const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const todayISO = () => isoDate(new Date());

export function fmtDate(iso, { weekday = true } = {}) {
  const [y, m, d] = iso.split('-').map(Number);
  const opts = { day: 'numeric', month: 'short' };
  if (weekday) opts.weekday = 'short';
  if (y !== new Date().getFullYear()) opts.year = 'numeric';
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', opts);
}

// Accepts both "82.5" and "82,5" (the iOS decimal keypad follows the phone's region).
export function parseNum(text) {
  const n = parseFloat(String(text).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export const fmtNum = n => String(Math.round(n * 100) / 100);

// "140 × 3 @ 8": weight × reps, then the effort (RPE) when one was given.
export const fmtSet = set =>
  (set.weight > 0 ? `${fmtNum(set.weight)} × ${set.reps}` : `${set.reps} reps`) +
  (set.rpe ? ` @ ${fmtNum(set.rpe)}` : '') +
  (set.failed ? (set.target ? ` (failed, aimed ${set.target})` : ' (failed)') : '');

// A day's sets on one line, with the top set starred.
export const fmtSets = sets => sets.map(set => (set.top ? '★ ' : '') + fmtSet(set)).join(' · ');

// RPE (rate of perceived exertion) is logged on the 5-10 part of the scale.
export const validRpe = n => n != null && n >= 5 && n <= 10;

// ---- Estimated one-rep max ----

const epley = (w, r) => w * (1 + r / 30);
// Undefined at 37 reps, hence the cap.
const brzycki = (w, r) => (w * 36) / (37 - Math.min(r, 30));

const wathan = (w, r) => (100 * w) / (48.8 + 53.8 * Math.exp(-0.075 * r));
const mayhew = (w, r) => (100 * w) / (52.2 + 41.9 * Math.exp(-0.055 * r));

// The formulas offered in More → 1RM formula. `fn` takes the weight, the number of reps
// and which main lift it is ('bench', 'pullup', 'deadlift', 'squat' or undefined).
export const FORMULAS = [
  { key: 'bylift', name: 'Mayhew + Wathan', note: 'Mayhew for the bench press, Wathan for every other lift', fn: (w, r, lift) => (lift === 'bench' ? mayhew(w, r) : wathan(w, r)) },
  { key: 'mixed', name: 'Epley + Brzycki', note: 'Epley up to 6 reps, Brzycki from 7', fn: (w, r) => (r < 7 ? epley(w, r) : brzycki(w, r)) },
  { key: 'epley', name: 'Epley', note: 'w × (1 + reps / 30)', fn: epley },
  { key: 'brzycki', name: 'Brzycki', note: 'w × 36 / (37 − reps)', fn: brzycki },
  { key: 'wathan', name: 'Wathan', note: '100 × w / (48.8 + 53.8 × e^(−0.075 × reps))', fn: wathan },
  { key: 'mayhew', name: 'Mayhew', note: '100 × w / (52.2 + 41.9 × e^(−0.055 × reps))', fn: mayhew },
  { key: 'lombardi', name: 'Lombardi', note: 'w × reps^0.10', fn: (w, r) => w * r ** 0.1 },
  { key: 'oconner', name: "O'Conner", note: 'w × (1 + 0.025 × reps)', fn: (w, r) => w * (1 + 0.025 * r) },
];

// The chosen formula is a preference of this device, kept outside the workout data.
const FORMULA_SETTING = 'gym-log.formula';

function storedFormula() {
  try {
    return localStorage.getItem(FORMULA_SETTING);
  } catch {
    return null;
  }
}

const DEFAULT_FORMULA = FORMULAS.find(f => f.key === 'bylift');

let formula = FORMULAS.find(f => f.key === storedFormula()) ?? DEFAULT_FORMULA;

export const currentFormula = () => formula.key;

export function setFormula(key) {
  formula = FORMULAS.find(f => f.key === key) ?? DEFAULT_FORMULA;
  try {
    localStorage.setItem(FORMULA_SETTING, formula.key);
  } catch {
    // Without storage the choice simply lasts until the app is closed.
  }
}

// Estimate of a one-rep max with the chosen formula (or the one named by `key`). `lift`
// says which main lift the set belongs to, for formulas that differ by lift.
// An RPE below 10 adds the reps left in the tank, so 100 × 5 @ 8 is rated like 100 × 7.
// A single all-out rep is the weight itself whatever the formula.
export function oneRepMax(weight, reps, rpe, { key, lift } = {}) {
  const effective = reps + (rpe ? 10 - rpe : 0);
  if (effective <= 1) return weight;
  const chosen = key ? FORMULAS.find(f => f.key === key) : formula;
  return chosen.fn(weight, effective, lift);
}

export function toast(message) {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: 'toast' }, message);
  document.body.append(el);
  setTimeout(() => el.remove(), 2600);
}
