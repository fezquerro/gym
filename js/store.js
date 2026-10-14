// In-memory copy of all data plus the domain logic (records, last performance, sessions).
// Everything is loaded once at startup; changes are written through to IndexedDB.

import * as db from './db.js';
import { oneRepMax, todayISO, uid } from './util.js';

export const state = { exercises: [], routines: [], sessions: [], records: [] };

const STARTER_EXERCISES = [
  'Bench Press', 'Incline Dumbbell Press', 'Overhead Press', 'Lateral Raise', 'Triceps Pushdown', 'Dip',
  'Pull-up', 'Lat Pulldown', 'Barbell Row', 'Seated Cable Row', 'Face Pull', 'Dumbbell Curl',
  'Squat', 'Deadlift', 'Romanian Deadlift', 'Leg Press', 'Leg Extension', 'Leg Curl', 'Hip Thrust', 'Calf Raise',
];

export async function load() {
  const data = await Promise.all(db.STORES.map(db.getAll));
  db.STORES.forEach((name, i) => (state[name] = data[i]));
  if (!state.exercises.length && !state.sessions.length && !state.records.length) {
    state.exercises = STARTER_EXERCISES.map(name => ({ id: uid(), name }));
    await db.putMany('exercises', state.exercises);
  }
  assignMainLifts();
}

// ---- Main lifts ----
// The four lifts that get a 1RM estimate in the workout and a line on the Progress chart.
// Each is held by one exercise (`exercise.main`), picked by name the first time it shows
// up and kept through renames. Pull-ups are logged as extra weight on top of bodyweight.

export const MAIN_LIFTS = [
  { key: 'bench', label: 'Bench Press', match: /^bench( press)?$|^press (de )?banca$/ },
  { key: 'pullup', label: 'Pull-up', match: /^(weighted )?(pull|chin)[- ]?ups?$|^dominadas?( lastradas?)?$/ },
  { key: 'deadlift', label: 'Deadlift', match: /^deadlifts?$|^peso muerto$/ },
  { key: 'squat', label: 'Squat', match: /^(back )?squats?$|^sentadillas?$/ },
];

function assignMainLifts() {
  for (const lift of MAIN_LIFTS) {
    if (state.exercises.some(e => e.main === lift.key)) continue;
    const free = state.exercises.filter(e => !e.main && !e.archived);
    const name = e => e.name.trim().toLowerCase();
    const found = free.find(e => name(e) === lift.label.toLowerCase()) ?? free.find(e => lift.match.test(name(e)));
    if (!found) continue;
    found.main = lift.key;
    db.put('exercises', found);
  }
}

// ---- Exercises ----

export const exercise = id => state.exercises.find(e => e.id === id);
export const exerciseName = id => exercise(id)?.name ?? 'Deleted exercise';
export const activeExercises = () =>
  state.exercises.filter(e => !e.archived).sort((a, b) => a.name.localeCompare(b.name));

export function addExercise(name) {
  const existing = state.exercises.find(e => e.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    if (existing.archived) {
      existing.archived = false;
      db.put('exercises', existing);
    }
    return existing;
  }
  const created = { id: uid(), name };
  state.exercises.push(created);
  db.put('exercises', created);
  assignMainLifts();
  return created;
}

export function renameExercise(ex, name) {
  ex.name = name;
  db.put('exercises', ex);
  assignMainLifts();
}

// An exercise that already appears in a workout is only hidden, so history keeps its name.
export function removeExercise(ex) {
  for (const routine of state.routines) {
    if (routine.exerciseIds.includes(ex.id)) {
      routine.exerciseIds = routine.exerciseIds.filter(id => id !== ex.id);
      db.put('routines', routine);
    }
  }
  const used = state.sessions.some(s => s.entries.some(e => e.exerciseId === ex.id)) ||
    state.records.some(r => r.exerciseId === ex.id);
  if (used) {
    ex.archived = true;
    db.put('exercises', ex);
  } else {
    state.exercises = state.exercises.filter(e => e !== ex);
    db.del('exercises', ex.id);
  }
}

// ---- Routines ----

export function saveRoutine(routine) {
  if (!state.routines.includes(routine)) state.routines.push(routine);
  db.put('routines', routine);
  return routine;
}

// routine: { id, name, exerciseIds, sets }, where `sets` maps an exercise id to how many
// sets a workout started from the routine gets for it.
export const DEFAULT_SETS = 3;

export const newRoutine = (name = '', exerciseIds = [], sets = {}) =>
  saveRoutine({ id: uid(), name, exerciseIds, sets });

export const routineSets = (routine, exerciseId) => routine.sets?.[exerciseId] ?? DEFAULT_SETS;

// "Squat ×4 · Bench Press ×3"
export const routineSummary = routine =>
  routine.exerciseIds.map(id => `${exerciseName(id)} ×${routineSets(routine, id)}`).join(' · ');

export function deleteRoutine(routine) {
  state.routines = state.routines.filter(r => r !== routine);
  db.del('routines', routine.id);
}

export const routineName = id => state.routines.find(r => r.id === id)?.name || null;

// ---- Sessions ----
// session: { id, date, startedAt, finishedAt, bodyweight, notes, routineId, entries }
// entry:   { exerciseId, sets: [{ weight, reps, rpe, top, done }] }
// Only sets with `done` count towards history, records and exports.
// `top` marks the top set of an exercise; `rpe` is the effort, as in "140 × 3 @ 8".
// `failed` marks a set that fell short of the planned reps, which go in `target`.

export const newSet = () =>
  ({ weight: null, reps: null, rpe: null, top: false, done: false, failed: false, target: null });

export const activeSession = () => state.sessions.find(s => !s.finishedAt);

// Finished sessions, oldest first.
export const chronological = () =>
  state.sessions
    .filter(s => s.finishedAt)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startedAt - b.startedAt);

// Finished sessions up to `session`'s date, excluding `session` itself (all of them if omitted).
const before = session =>
  chronological().filter(s => !session || (s.id !== session.id && s.date <= session.date));

const doneSets = (session, exerciseId) =>
  session.entries
    .filter(e => e.exerciseId === exerciseId)
    .flatMap(e => e.sets.filter(set => set.done))
    .map(set => ({
      weight: set.weight ?? 0, reps: set.reps, rpe: set.rpe ?? null, top: !!set.top,
      failed: !!set.failed, target: set.failed ? set.target ?? null : null,
    }));

// [{ date, bodyweight, sets }] for one exercise from logged workouts, oldest first.
export const exerciseHistory = (exerciseId, session) =>
  before(session)
    .map(s => ({ date: s.date, bodyweight: s.bodyweight, sets: doneSets(s, exerciseId) }))
    .filter(day => day.sets.length);

export const lastSets = (exerciseId, session) => exerciseHistory(exerciseId, session).at(-1);

// Returns a function giving the bodyweight on a date: the latest weigh-in up to then,
// else the first one after it, else null.
export function bodyweightLookup() {
  const known = bodyweights();
  return date => (known.filter(b => b.date <= date).at(-1) ?? known[0])?.value ?? null;
}

// Workout history plus the records added by hand or imported. Those are grouped into one
// entry per date, whose `manual` list lines up with its `sets`.
// For pull-ups every day also gets the bodyweight that applied then.
export function liftLog(exerciseId, session) {
  const weighIn = exercise(exerciseId)?.main === 'pullup' ? bodyweightLookup() : () => null;
  const byHand = new Map();
  for (const record of state.records) {
    if (record.exerciseId !== exerciseId || (session && record.date > session.date)) continue;
    const day = byHand.get(record.date) ?? { date: record.date, bodyweight: null, manual: [], sets: [] };
    day.manual.push(record);
    day.bodyweight ??= record.bodyweight ?? null;
    day.sets.push({ weight: record.weight, reps: record.reps, rpe: record.rpe ?? null, top: true });
    byHand.set(record.date, day);
  }
  return [...exerciseHistory(exerciseId, session), ...byHand.values()]
    .map(day => ({ ...day, bodyweight: day.bodyweight ?? weighIn(day.date) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// The set that stands for a day: the one marked as top set, else the heaviest.
export function topSet(day) {
  const marked = day.sets.filter(set => set.top);
  return (marked.length ? marked : day.sets).reduce((best, set) =>
    set.weight > best.weight || (set.weight === best.weight && set.reps > best.reps) ? set : best);
}

// Estimated 1RM of a set, in kg. Pull-ups are logged as extra weight only, so they are
// worked out on bodyweight + extra and given back as extra weight; while no bodyweight
// is known they fall back to the plain estimate.
export function estimate1rm(exerciseId, set, bodyweight) {
  const weight = set.weight ?? 0;
  const lift = exercise(exerciseId)?.main;
  if (lift !== 'pullup' || bodyweight == null) return oneRepMax(weight, set.reps, set.rpe, { lift });
  return oneRepMax(bodyweight + weight, set.reps, set.rpe, { lift }) - bodyweight;
}

// Best lifts for one exercise: heaviest weight, best estimated 1RM and most reps in a set.
export function records(exerciseId, session) {
  let heaviest = null, best1rm = null, mostReps = null;
  for (const { date, sets, bodyweight } of liftLog(exerciseId, session)) {
    for (const set of sets) {
      const lift = { ...set, date, e1rm: estimate1rm(exerciseId, set, bodyweight) };
      if (!heaviest || lift.weight > heaviest.weight ||
          (lift.weight === heaviest.weight && lift.reps > heaviest.reps)) heaviest = lift;
      if (!best1rm || lift.e1rm > best1rm.e1rm) best1rm = lift;
      if (!mostReps || lift.reps > mostReps.reps ||
          (lift.reps === mostReps.reps && lift.weight > mostReps.weight)) mostReps = lift;
    }
  }
  return heaviest && { heaviest, best1rm, mostReps };
}

// Does `set` beat the records in `rec` (from earlier sessions)? `estimate` is the set's
// estimated 1RM. A first-ever set is not a record.
export function isPR(set, rec, estimate) {
  if (!rec || !set.done) return false;
  const weight = set.weight ?? 0;
  if (weight > rec.heaviest.weight) return true;
  if (weight > 0) return estimate > rec.best1rm.e1rm + 1e-9;
  return rec.heaviest.weight === 0 && set.reps > rec.mostReps.reps;
}

// The top set of each main lift done in a workout, in MAIN_LIFTS order: [{ exercise, set }].
export const sessionTopSets = session =>
  MAIN_LIFTS
    .map(lift => state.exercises.find(e => e.main === lift.key))
    .filter(Boolean)
    .map(ex => ({ exercise: ex, sets: doneSets(session, ex.id) }))
    .filter(item => item.sets.length)
    .map(item => ({ exercise: item.exercise, set: topSet(item) }));

export function sessionStats(session) {
  let sets = 0, volume = 0;
  for (const entry of session.entries) {
    for (const set of entry.sets) {
      if (!set.done) continue;
      sets += 1;
      volume += (set.weight ?? 0) * set.reps;
    }
  }
  return { sets, volume };
}

// Every known bodyweight, oldest first, one per day: from workouts, and from records
// added by hand on days without a workout weigh-in.
export function bodyweights() {
  const byDate = new Map();
  for (const session of chronological()) {
    if (session.bodyweight != null) byDate.set(session.date, session.bodyweight);
  }
  for (const record of state.records) {
    if (record.bodyweight != null && !byDate.has(record.date)) byDate.set(record.date, record.bodyweight);
  }
  return [...byDate]
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Adds an exercise with `count` empty sets, or as many as were logged last time.
export function addEntry(session, exerciseId, count) {
  count ??= lastSets(exerciseId, session)?.sets.length ?? DEFAULT_SETS;
  session.entries.push({ exerciseId, sets: Array.from({ length: count }, newSet) });
}

export function startSession(routine) {
  const session = {
    id: uid(),
    date: todayISO(),
    startedAt: Date.now(),
    finishedAt: null,
    bodyweight: null,
    notes: '',
    routineId: routine?.id ?? null,
    entries: [],
  };
  for (const id of routine?.exerciseIds ?? []) addEntry(session, id, routineSets(routine, id));
  state.sessions.push(session);
  db.put('sessions', session);
  return session;
}

// Drops sets that were never completed and exercises left without sets.
// Returns false when nothing is left.
export function tidy(session) {
  for (const entry of session.entries) {
    entry.sets = entry.sets.filter(set => set.done);
    for (const set of entry.sets) set.weight ??= 0;
  }
  session.entries = session.entries.filter(entry => entry.sets.length);
  return session.entries.length > 0;
}

// Typing fires a save per keystroke, so session writes are batched.
const pending = new Map();
let timer;

export function saveSession(session) {
  pending.set(session.id, session);
  clearTimeout(timer);
  timer = setTimeout(flush, 400);
}

export function flush() {
  clearTimeout(timer);
  if (!pending.size) return Promise.resolve();
  const sessions = [...pending.values()];
  pending.clear();
  return db.putMany('sessions', sessions);
}

export function deleteSession(session) {
  pending.delete(session.id);
  state.sessions = state.sessions.filter(s => s !== session);
  db.del('sessions', session.id);
}

// ---- Records added by hand or imported ----
// record: { id, exerciseId, date, weight, reps, rpe, bodyweight }

export function addRecord(record) {
  const saved = { id: uid(), ...record };
  state.records.push(saved);
  db.put('records', saved);
  return saved;
}

export function deleteRecord(record) {
  state.records = state.records.filter(r => r !== record);
  db.del('records', record.id);
}

export function deleteAllRecords() {
  state.records = [];
  return db.replaceStore('records', []);
}

// rows: [{ exercise, date, weight, reps, rpe, bodyweight }]. Unknown exercises are created and lifts
// that are already recorded are skipped. Returns how many were added.
export function importRecords(rows) {
  const fresh = [];
  for (const row of rows) {
    const exerciseId = addExercise(row.exercise).id;
    const same = r =>
      r.exerciseId === exerciseId && r.date === row.date && r.weight === row.weight && r.reps === row.reps;
    if (state.records.some(same) || fresh.some(same)) continue;
    fresh.push({
      id: uid(), exerciseId, date: row.date, weight: row.weight, reps: row.reps,
      rpe: row.rpe ?? null, bodyweight: row.bodyweight ?? null,
    });
  }
  state.records.push(...fresh);
  if (fresh.length) db.putMany('records', fresh);
  return fresh.length;
}

// ---- Backup ----

export const backup = () => ({
  app: 'gym-log',
  version: 2,
  exportedAt: new Date().toISOString(),
  ...state,
});

// Backups made before records existed have no `records` list.
export const isBackup = data =>
  data?.app === 'gym-log' && ['exercises', 'routines', 'sessions'].every(name => Array.isArray(data[name]));

export async function restore(data) {
  await flush();
  const next = Object.fromEntries(db.STORES.map(name => [name, data[name] ?? []]));
  await db.replaceAll(next);
  Object.assign(state, next);
  assignMainLifts();
}
