// Reads past lifts from a CSV file so they can be added as records.

import { parseNum, validRpe } from './util.js';

const COLUMNS = {
  date: ['date', 'fecha'],
  exercise: ['exercise', 'ejercicio', 'lift'],
  weight: ['weight', 'peso', 'kg'],
  reps: ['reps', 'repeticiones', 'repetitions'],
  rpe: ['rpe', '@'],
  bodyweight: ['bodyweight', 'body weight', 'bw', 'peso corporal'],
  top: ['top set', 'top'],
  failed: ['failed', 'fallo', 'fallida'],
  target: ['planned', 'target', 'objetivo'],
  routine: ['routine', 'rutina'],
  notes: ['notes', 'notas'],
};

// Excel saves CSV in the Windows code page unless told otherwise, so fall back to it.
export async function readText(file) {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

function splitCSV(text, sep) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = false;
    } else if (c === '"') {
      quoted = true;
    } else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (c !== '\r') {
      cell += c;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// Accepts 2026-10-13 and day-first dates such as 13/10/2026 or 13-10-26.
function parseDate(text) {
  const value = text.trim();
  let year, month, day;
  let m = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    [year, month, day] = [m[1], m[2], m[3]].map(Number);
  } else if ((m = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/))) {
    [day, month, year] = [m[1], m[2], m[3]].map(Number);
    if (year < 100) year += 2000;
  } else {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Splits a CSV file into its non-empty data rows plus a `read(row)` that gives one row's
// values by column name, with the basic checks done. Throws when the file has no usable
// header row.
function readTable(text) {
  const clean = text.replace(/^﻿/, '');
  const header = clean.split('\n', 1)[0];
  const sep = [';', '\t', ','].reduce((best, s) => (header.split(s).length > header.split(best).length ? s : best));
  const [head, ...rows] = splitCSV(clean, sep);

  const names = (head ?? []).map(name => name.trim().toLowerCase());
  // Bodyweight is matched first and left out of the rest, since "Peso corporal" also starts like "Peso".
  const column = (key, taken = -1) =>
    names.findIndex((name, i) => i !== taken && COLUMNS[key].some(alias => name.startsWith(alias)));
  const bodyweightAt = column('bodyweight');
  const at = Object.fromEntries(Object.keys(COLUMNS).map(key =>
    [key, key === 'weight' ? column(key, bodyweightAt) : column(key)]));
  if (at.date < 0 || at.exercise < 0 || at.weight < 0 || at.reps < 0) {
    throw new Error('The file needs Date, Exercise, Weight and Reps columns');
  }

  const cell = (row, key) => (at[key] < 0 ? '' : (row[at[key]] ?? '').trim());
  const yes = text => /^(yes|y|si|sí|true|x|1)$/i.test(text);
  const read = row => {
    const rpe = parseNum(cell(row, 'rpe'));
    const failed = yes(cell(row, 'failed'));
    return {
      date: parseDate(cell(row, 'date')),
      exercise: cell(row, 'exercise'),
      weight: parseNum(cell(row, 'weight')),
      reps: Math.round(parseNum(cell(row, 'reps')) ?? 0),
      rpe: validRpe(rpe) ? rpe : null,
      bodyweight: parseNum(cell(row, 'bodyweight')) || null,
      top: yes(cell(row, 'top')),
      failed,
      target: failed ? Math.round(parseNum(cell(row, 'target')) ?? 0) || null : null,
      routine: cell(row, 'routine'),
      notes: cell(row, 'notes'),
    };
  };
  // A failed set may have 0 reps (a missed attempt); any other set needs at least one.
  const valid = lift => lift.date && lift.exercise && lift.weight != null && (lift.reps >= 1 || lift.failed);
  return { rows: rows.filter(row => row.some(value => value.trim())), read, valid };
}

// Returns { lifts: [{ exercise, date, weight, reps, rpe, bodyweight }], skipped } or throws when the
// file has no usable header row.
export function parseLifts(text) {
  const { rows, read, valid } = readTable(text);
  const lifts = [];
  let skipped = 0;
  for (const row of rows) {
    const lift = read(row);
    // Records are lifts that were made, so missed attempts are left out here.
    if (!valid(lift) || lift.reps < 1) {
      skipped += 1;
      continue;
    }
    const { exercise, date, weight, reps, rpe, bodyweight } = lift;
    lifts.push({ exercise, date, weight, reps, rpe, bodyweight });
  }
  return { lifts, skipped };
}

// Reads whole workouts: every row is one set, and the rows of a date make up that day's
// workout, with exercises and sets in file order. Same columns as the app's own CSV export.
// Returns { workouts: [{ date, bodyweight, routine, notes, entries: [{ exercise, sets }] }], skipped }.
export function parseWorkouts(text) {
  const { rows, read, valid } = readTable(text);
  const days = new Map();
  let skipped = 0;
  for (const row of rows) {
    const lift = read(row);
    // Records added by hand also appear in the export; they are not workout sets.
    if (lift.notes === 'Record added by hand') continue;
    if (!valid(lift)) {
      skipped += 1;
      continue;
    }
    const day = days.get(lift.date) ?? { date: lift.date, bodyweight: null, routine: '', notes: new Set(), entries: [] };
    day.bodyweight ??= lift.bodyweight;
    day.routine ||= lift.routine;
    if (lift.notes) day.notes.add(lift.notes);
    let entry = day.entries.find(e => e.exercise.toLowerCase() === lift.exercise.toLowerCase());
    if (!entry) {
      entry = { exercise: lift.exercise, sets: [] };
      day.entries.push(entry);
    }
    const { weight, reps, rpe, top, failed, target } = lift;
    entry.sets.push({ weight, reps, rpe, top, failed, target });
    days.set(lift.date, day);
  }
  const workouts = [...days.values()]
    .map(day => ({ ...day, notes: [...day.notes].join(' · ') }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { workouts, skipped };
}
