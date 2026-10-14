// Getting data out of the phone: a spreadsheet-friendly CSV and a full JSON backup.

import { bodyweightLookup, chronological, estimate1rm, exerciseName, routineName, state } from './store.js';
import { fmtNum, todayISO } from './util.js';

// One row per completed set, plus one per record added by hand. Follows the device's
// number format so Excel opens it correctly: regions that write decimals with a comma
// get ";" as the column separator.
export function toCSV() {
  const decimal = (1.5).toLocaleString().includes(',') ? ',' : '.';
  const sep = decimal === ',' ? ';' : ',';
  const num = n => (n == null ? '' : fmtNum(n).replace('.', decimal));
  const cell = value => {
    const text = String(value ?? '');
    return text.includes(sep) || /["\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  // Pull-up estimates need the bodyweight of the day (see estimate1rm).
  const weighIn = bodyweightLookup();
  const lift = (exerciseId, set, bodyweight) => {
    const estimate = estimate1rm(exerciseId, set, bodyweight);
    return [
      num(set.weight ?? 0), set.reps, num(set.rpe), set.top ? 'yes' : '',
      set.failed ? 'yes' : '', set.failed ? set.target ?? '' : '', set.reps >= 1 && estimate > 0 ? num(estimate) : '',
    ];
  };

  const rows = [];
  for (const session of chronological()) {
    const bodyweight = session.bodyweight ?? weighIn(session.date);
    for (const entry of session.entries) {
      let n = 0;
      for (const set of entry.sets) {
        if (!set.done) continue;
        rows.push([
          session.date, exerciseName(entry.exerciseId), ++n, ...lift(entry.exerciseId, set, bodyweight),
          num(session.bodyweight), routineName(session.routineId), session.notes,
        ]);
      }
    }
  }
  for (const record of state.records) {
    rows.push([
      record.date, exerciseName(record.exerciseId), '',
      ...lift(record.exerciseId, record, record.bodyweight ?? weighIn(record.date)),
      num(record.bodyweight), '', 'Record added by hand',
    ]);
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  rows.unshift([
    'Date', 'Exercise', 'Set', 'Weight (kg)', 'Reps', 'RPE', 'Top set', 'Failed', 'Planned reps', 'Est. 1RM (kg)',
    'Bodyweight (kg)', 'Routine', 'Notes',
  ]);
  // The BOM makes Excel read the file as UTF-8.
  return '﻿' + rows.map(row => row.map(cell).join(sep)).join('\r\n');
}

export const fileName = ext => `gym-log-${todayISO()}.${ext}`;

// On a phone this opens the share sheet (Save to Files, Mail, AirDrop...); on a computer it downloads.
export async function deliver(name, type, text) {
  const file = new File([text], name, { type });
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(file);
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
