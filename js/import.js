// Reads past lifts from a CSV file so they can be added as records.

import { parseNum, validRpe } from './util.js';

const COLUMNS = {
  date: ['date', 'fecha'],
  exercise: ['exercise', 'ejercicio', 'lift'],
  weight: ['weight', 'peso', 'kg'],
  reps: ['reps', 'repeticiones', 'repetitions'],
  rpe: ['rpe', '@'],
  bodyweight: ['bodyweight', 'body weight', 'bw', 'peso corporal'],
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

// Returns { lifts: [{ exercise, date, weight, reps, rpe, bodyweight }], skipped } or throws when the
// file has no usable header row.
export function parseLifts(text) {
  const clean = text.replace(/^﻿/, '');
  const header = clean.split('\n', 1)[0];
  const sep = [';', '\t', ','].reduce((best, s) => (header.split(s).length > header.split(best).length ? s : best));
  const [head, ...rows] = splitCSV(clean, sep);

  const names = (head ?? []).map(name => name.trim().toLowerCase());
  // Bodyweight is matched first and left out of the rest, since "Peso corporal" also starts like "Peso".
  const column = (key, taken = -1) =>
    names.findIndex((name, i) => i !== taken && COLUMNS[key].some(alias => name.startsWith(alias)));
  const bodyweightAt = column('bodyweight');
  const at = {
    date: column('date'), exercise: column('exercise'), weight: column('weight', bodyweightAt),
    reps: column('reps'), rpe: column('rpe'), bodyweight: bodyweightAt,
  };
  if (at.date < 0 || at.exercise < 0 || at.weight < 0 || at.reps < 0) {
    throw new Error('The file needs Date, Exercise, Weight and Reps columns');
  }

  const lifts = [];
  let skipped = 0;
  for (const row of rows) {
    if (row.every(cell => !cell.trim())) continue;
    const date = parseDate(row[at.date] ?? '');
    const exercise = (row[at.exercise] ?? '').trim();
    const weight = parseNum(row[at.weight] ?? '');
    const reps = Math.round(parseNum(row[at.reps] ?? '') ?? 0);
    const rpe = at.rpe < 0 ? null : parseNum(row[at.rpe] ?? '');
    if (!date || !exercise || weight == null || reps < 1) {
      skipped += 1;
      continue;
    }
    const bodyweight = at.bodyweight < 0 ? null : parseNum(row[at.bodyweight] ?? '');
    lifts.push({ exercise, date, weight, reps, rpe: validRpe(rpe) ? rpe : null, bodyweight: bodyweight || null });
  }
  return { lifts, skipped };
}
