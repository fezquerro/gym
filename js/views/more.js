import { deliver, fileName, toCSV } from '../export.js';
import { go, refresh } from '../nav.js';
import { parseLifts, parseWorkouts, readText } from '../import.js';
import {
  activeExercises, addExercise, backup, chronological, deleteAllRecords, deleteRecord, deleteRoutine,
  exerciseName, importRecords, importWorkouts, isBackup, newRoutine, removeExercise, renameExercise, restore,
  routineSets, routineSummary, saveRoutine, state,
} from '../store.js';
import {
  FORMULAS, currentFormula, fmtDate, fmtNum, fmtSet, h, mount, oneRepMax, parseNum, setFormula, toast,
  validRpe,
} from '../util.js';
import { page } from './common.js';
import { pickExercise } from './picker.js';

export function moreView(route) {
  if (route.page === 'routines') return routinesPage();
  if (route.page === 'exercises') return exercisesPage();
  if (route.page === 'data') return dataPage();
  if (route.page === 'records') return recordsPage();
  if (route.page === 'formula') return formulaPage();
  if (route.page === 'routine') {
    const routine = state.routines.find(r => r.id === route.params.id);
    if (routine) return routineEditor(routine);
  }

  const link = (title, detail, target) =>
    h('button', { class: 'card', onclick: () => go('more', target) },
      h('strong', null, title), h('span', { class: 'muted small' }, detail));

  return page('More', {},
    link('Routines', 'Saved workouts you can start with one tap', 'routines'),
    link('Exercises', 'Add, rename or remove exercises', 'exercises'),
    link('Records added by hand', `${state.records.length} added or imported · review and delete them`, 'records'),
    link('1RM formula', `${FORMULAS.find(f => f.key === currentFormula()).name} · choose and compare formulas`, 'formula'),
    link('Export & backup', 'Send your data to the computer, restore a backup or import records', 'data'),
  );
}

// Example set for the comparison on the formula page; kept while the app stays open.
const example = { weight: '100', reps: '5', rpe: '', lift: 'bench' };

function formulaPage() {
  const results = h('div', { class: 'table-scroll' });
  const number = (key, mode, placeholder) => h('input', {
    class: 'num',
    inputMode: mode,
    autocomplete: 'off',
    placeholder,
    value: example[key],
    oninput: e => {
      example[key] = e.target.value;
      compare();
    },
  });

  // One row per formula for the example set, with the difference from the chosen formula.
  function compare() {
    const weight = parseNum(example.weight);
    const reps = Math.round(parseNum(example.reps) ?? 0);
    const rpe = parseNum(example.rpe);
    if (weight == null || reps < 1 || (example.rpe.trim() && !validRpe(rpe))) {
      mount(results, h('p', { class: 'muted small' }, 'Enter a weight and reps (RPE from 5 to 10, or empty).'));
      return;
    }
    const effort = example.rpe.trim() ? rpe : null;
    const round1 = n => Math.round(n * 10) / 10;
    const { lift } = example;
    const chosen = round1(oneRepMax(weight, reps, effort, { lift }));
    mount(results, h('table', null,
      h('thead', null, h('tr', null, ['Formula', 'Est. 1RM', 'Difference'].map(text => h('th', null, text)))),
      h('tbody', null, FORMULAS.map(f => {
        const value = round1(oneRepMax(weight, reps, effort, { key: f.key, lift }));
        const diff = round1(value - chosen);
        return h('tr', { class: f.key === currentFormula() ? 'chosen' : '' },
          h('td', null, f.name),
          h('td', null, `${fmtNum(value)} kg`),
          h('td', null, f.key === currentFormula() ? 'in use' : diff === 0 ? '0' : `${diff > 0 ? '+' : '−'}${fmtNum(Math.abs(diff))}`),
        );
      })),
    ));
  }
  compare();

  return page('1RM formula', { back: () => go('more') },
    h('p', { class: 'muted' },
      'The formula used for every estimated 1RM in the app: workouts, records, charts and the export. Changing it recalculates everything.'),
    FORMULAS.map(f =>
      h('button', {
        class: `card row choice${f.key === currentFormula() ? ' on' : ''}`,
        'aria-pressed': String(f.key === currentFormula()),
        onclick: () => {
          setFormula(f.key);
          refresh();
        },
      },
        h('div', { class: 'stack' }, h('strong', null, f.name), h('span', { class: 'muted small' }, f.note)),
        h('span', { class: 'tick' }, f.key === currentFormula() ? '✓' : ''),
      )),
    h('h2', null, 'Compare with an example'),
    h('section', { class: 'card' },
      // Only matters for formulas that differ by lift (Mayhew + Wathan).
      h('div', { class: 'chips', role: 'group', 'aria-label': 'Lift for the example' },
        [['bench', 'Bench press'], ['other', 'Any other lift']].map(([lift, label]) =>
          h('button', {
            class: example.lift === lift ? 'on' : '',
            'aria-pressed': String(example.lift === lift),
            onclick: () => {
              example.lift = lift;
              refresh();
            },
          }, label))),
      h('div', { class: 'set head example' }, h('span', null, 'kg'), h('span', null, 'Reps'), h('span', null, '@ RPE')),
      h('div', { class: 'set example' }, number('weight', 'decimal'), number('reps', 'numeric'), number('rpe', 'decimal', 'optional')),
      results,
      h('p', { class: 'muted small' },
        'With an RPE, the reps left in the tank (10 − RPE) are added to the reps before the formula is applied. A single all-out rep always counts as the weight itself.'),
    ),
  );
}

// Every record that was typed in or imported, with a way to delete them: grouped by
// exercise, heaviest first (equal weights by reps, then newest first).
function recordsPage() {
  const records = [...state.records].sort((a, b) =>
    exerciseName(a.exerciseId).localeCompare(exerciseName(b.exerciseId)) ||
    b.weight - a.weight || b.reps - a.reps || b.date.localeCompare(a.date));
  const count = records.length;

  return page('Records added by hand', { back: () => go('more') },
    h('p', { class: 'muted' },
      count
        ? `${count} record${count === 1 ? '' : 's'} added by hand or imported. Deleting them does not touch your logged workouts.`
        : 'No records added by hand. Add one from the Progress tab, or import a file in Export & backup.'),
    count > 0 && h('button', {
      class: 'btn danger',
      onclick: async () => {
        if (!confirm(`Delete all ${count} records added by hand? This cannot be undone.`)) return;
        await deleteAllRecords();
        toast('Records deleted');
        refresh();
      },
    }, `Delete all ${count}`),
    records.map(record =>
      h('div', { class: 'card row' },
        h('div', { class: 'stack' },
          h('strong', null, exerciseName(record.exerciseId)),
          h('span', { class: 'muted small' },
            [fmtSet(record), fmtDate(record.date, { weekday: false }), record.bodyweight && `BW ${fmtNum(record.bodyweight)} kg`]
              .filter(Boolean).join(' · ')),
        ),
        h('button', {
          class: 'btn danger compact',
          onclick: () => {
            if (!confirm('Delete this record?')) return;
            deleteRecord(record);
            refresh();
          },
        }, 'Delete'),
      )),
  );
}

function routinesPage() {
  return page('Routines', { back: () => go('more') },
    state.routines.map(routine =>
      h('button', { class: 'card', onclick: () => go('more', 'routine', { id: routine.id }) },
        h('strong', null, routine.name || 'Untitled routine'),
        h('span', { class: 'muted small' },
          routineSummary(routine) || 'No exercises yet'),
      )),
    h('button', { class: 'btn primary', onclick: () => go('more', 'routine', { id: newRoutine().id }) },
      '+ New routine'),
  );
}

function routineEditor(routine) {
  const save = () => saveRoutine(routine);
  const ids = routine.exerciseIds;
  const change = edit => () => {
    edit();
    save();
    refresh();
  };

  const back = () => {
    if (!routine.name.trim() && !ids.length) deleteRoutine(routine);
    go('more', 'routines');
  };

  return page('Routine', { back },
    h('input', {
      value: routine.name,
      placeholder: 'Routine name, e.g. Push day',
      'aria-label': 'Routine name',
      oninput: e => {
        routine.name = e.target.value;
        save();
      },
    }),
    ids.map((id, i) => {
      const count = routineSets(routine, id);
      const setCount = n => change(() => (routine.sets = { ...routine.sets, [id]: n }));
      return h('div', { class: 'card' },
        h('div', { class: 'row' },
          h('strong', null, exerciseName(id)),
          h('div', { class: 'actions' },
            h('button', { class: 'icon', 'aria-label': 'Move up', disabled: i === 0,
              onclick: change(() => ([ids[i - 1], ids[i]] = [ids[i], ids[i - 1]])) }, '↑'),
            h('button', { class: 'icon', 'aria-label': 'Move down', disabled: i === ids.length - 1,
              onclick: change(() => ([ids[i + 1], ids[i]] = [ids[i], ids[i + 1]])) }, '↓'),
            h('button', { class: 'icon', 'aria-label': 'Remove', onclick: change(() => ids.splice(i, 1)) }, '✕'),
          ),
        ),
        h('div', { class: 'row' },
          h('span', { class: 'muted' }, 'Sets'),
          h('div', { class: 'stepper' },
            h('button', { 'aria-label': `One set fewer for ${exerciseName(id)}`, disabled: count <= 1, onclick: setCount(count - 1) }, '−'),
            h('strong', { 'aria-live': 'polite' }, count),
            h('button', { 'aria-label': `One set more for ${exerciseName(id)}`, disabled: count >= 12, onclick: setCount(count + 1) }, '+'),
          ),
        ),
      );
    }),
    h('button', { class: 'btn', onclick: () => pickExercise(id => change(() => ids.push(id))()) },
      '+ Add exercise'),
    h('button', {
      class: 'btn danger',
      onclick: () => {
        if (!confirm('Delete this routine? Past workouts are kept.')) return;
        deleteRoutine(routine);
        go('more', 'routines');
      },
    }, 'Delete routine'),
  );
}

function exercisesPage() {
  const name = h('input', { placeholder: 'New exercise name', autocomplete: 'off', 'aria-label': 'New exercise name' });
  const add = () => {
    if (!name.value.trim()) return;
    addExercise(name.value.trim());
    refresh();
  };
  name.addEventListener('keydown', e => {
    if (e.key === 'Enter') add();
  });

  return page('Exercises', { back: () => go('more') },
    h('div', { class: 'row' }, name, h('button', { class: 'btn add', onclick: add }, 'Add')),
    activeExercises().map(ex =>
      h('div', { class: 'row' },
        h('input', {
          value: ex.name,
          'aria-label': 'Exercise name',
          onchange: e => {
            const next = e.target.value.trim();
            if (next) renameExercise(ex, next);
            else e.target.value = ex.name;
          },
        }),
        h('button', {
          class: 'icon',
          'aria-label': `Remove ${ex.name}`,
          onclick: () => {
            if (!confirm(`Remove ${ex.name}? Workouts you already logged keep it.`)) return;
            removeExercise(ex);
            refresh();
          },
        }, '✕'),
      )),
  );
}

function dataPage() {
  const count = chronological().length;

  const importFile = async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      data = null;
    }
    if (!isBackup(data)) {
      toast('That file is not a Gym Log backup');
      return;
    }
    const workouts = data.sessions.filter(s => s.finishedAt).length;
    if (!confirm(`Replace everything in the app with this backup (${workouts} workouts)?`)) return;
    await restore(data);
    toast('Backup restored');
    refresh();
  };

  const picker = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: importFile });

  const importLifts = async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    let parsed;
    try {
      parsed = parseLifts(await readText(file));
    } catch (err) {
      toast(err.message);
      return;
    }
    const { lifts, skipped } = parsed;
    if (!lifts.length) {
      toast('No lifts found in that file');
      return;
    }
    const note = skipped ? ` (${skipped} row${skipped === 1 ? '' : 's'} could not be read)` : '';
    if (!confirm(`Add ${lifts.length} lift${lifts.length === 1 ? '' : 's'} from this file as records?${note}`)) return;
    const added = importRecords(lifts);
    toast(`${added} record${added === 1 ? '' : 's'} added`);
    refresh();
  };

  const liftPicker = h('input', { type: 'file', accept: '.csv,text/csv', hidden: true, onchange: importLifts });

  const importSessions = async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    let parsed;
    try {
      parsed = parseWorkouts(await readText(file));
    } catch (err) {
      toast(err.message);
      return;
    }
    const { workouts, skipped } = parsed;
    if (!workouts.length) {
      toast('No workouts found in that file');
      return;
    }
    const sets = workouts.reduce((n, w) => n + w.entries.reduce((m, e) => m + e.sets.length, 0), 0);
    const note = skipped ? ` (${skipped} row${skipped === 1 ? '' : 's'} could not be read)` : '';
    if (!confirm(`Add ${workouts.length} workout${workouts.length === 1 ? '' : 's'} (${sets} sets) from this file to your history?${note}`)) return;
    const added = importWorkouts(workouts);
    toast(`${added} workout${added === 1 ? '' : 's'} added`);
    refresh();
  };

  const workoutPicker = h('input', { type: 'file', accept: '.csv,text/csv', hidden: true, onchange: importSessions });

  return page('Export & backup', { back: () => go('more') },
    h('p', { class: 'muted' },
      `${count} workout${count === 1 ? '' : 's'} logged. Everything is stored on this device only, so export a backup now and then.`),
    h('section', { class: 'card' },
      h('strong', null, 'Spreadsheet'),
      h('span', { class: 'muted small' }, 'One row per set, with RPE, top sets, bodyweight and estimated 1RM. Opens in Excel or Google Sheets.'),
      h('button', { class: 'btn', onclick: () => deliver(fileName('csv'), 'text/csv', toCSV()) }, 'Export CSV'),
    ),
    h('section', { class: 'card' },
      h('strong', null, 'Full backup'),
      h('span', { class: 'muted small' }, 'Everything in one file. Import it here, on this phone or in the browser on your computer, to restore or move your data.'),
      h('button', { class: 'btn', onclick: () => deliver(fileName('json'), 'application/json', JSON.stringify(backup(), null, 2)) },
        'Export backup'),
      h('button', { class: 'btn', onclick: () => picker.click() }, 'Import backup'),
      picker,
    ),
    h('section', { class: 'card' },
      h('strong', null, 'Import records'),
      h('span', { class: 'muted small' },
        'Add past lifts from a CSV file. It needs a first row with the column names Date, Exercise, Weight and Reps; RPE and Bodyweight columns are optional. Dates can be 2026-10-13 or 13/10/2026. Nothing already in the app is replaced.'),
      h('button', { class: 'btn', onclick: () => liftPicker.click() }, 'Import records (CSV)'),
      liftPicker,
    ),
    h('section', { class: 'card' },
      h('strong', null, 'Import workouts'),
      h('span', { class: 'muted small' },
        'Add past workouts to your history from a CSV file with one row per set: Date, Exercise, Weight and Reps, plus optional Set, RPE, Top set, Failed, Planned reps, Bodyweight, Routine and Notes columns. The app\'s own CSV export works too. Workouts already in the app are skipped.'),
      h('button', { class: 'btn', onclick: () => workoutPicker.click() }, 'Import workouts (CSV)'),
      workoutPicker,
    ),
  );
}
