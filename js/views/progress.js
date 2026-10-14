import { barList, lineChart, trendChart } from '../chart.js';
import { go, refresh } from '../nav.js';
import {
  MAIN_LIFTS, addRecord, bodyweights, deleteRecord, estimate1rm, exercise, exerciseName, liftLog,
  records, state, topSet,
} from '../store.js';
import { fmtDate, fmtNum, fmtSet, fmtSets, h, isoDate, parseNum, toast, todayISO, validRpe } from '../util.js';
import { dataTable, page } from './common.js';
import { pickExercise } from './picker.js';

const round1 = n => Math.round(n * 10) / 10;
const kg = n => `${fmtNum(round1(n))} kg`;
const day = iso => fmtDate(iso, { weekday: false });

// "140 kg × 3 @ 8", or "12 reps" for lifts done without added weight.
const lift = set =>
  (set.weight > 0 ? `${fmtNum(set.weight)} kg × ${set.reps}` : `${set.reps} reps`) +
  (set.rpe ? ` @ ${fmtNum(set.rpe)}` : '');

// Time span shown by the charts on the overview; kept while the app stays open.
const RANGES = [{ key: '3m', label: '3 months', days: 92 }, { key: '1y', label: '1 year', days: 366 }, { key: 'all', label: 'All time' }];
let range = 'all';

function rangeStart() {
  const { days } = RANGES.find(r => r.key === range);
  if (!days) return '';
  const start = new Date();
  start.setDate(start.getDate() - days);
  return isoDate(start);
}

export function progressView(route) {
  if (route.page === 'exercise') return exerciseDetail(route.params.id);
  if (route.page === 'add') return addRecordPage(route.params.exerciseId);

  const open = ex => () => go('progress', 'exercise', { id: ex.id });
  const tracked = state.exercises
    .map(ex => ({ ex, rec: records(ex.id) }))
    .filter(item => item.rec)
    .sort((a, b) => a.ex.name.localeCompare(b.ex.name));
  const weighted = tracked.filter(item => item.rec.heaviest.weight > 0);
  const repsOnly = tracked.filter(item => item.rec.heaviest.weight === 0);
  const from = rangeStart();

  return page('Progress', {},
    h('div', { class: 'segmented', role: 'group', 'aria-label': 'Time span' },
      RANGES.map(r => h('button', {
        class: r.key === range ? 'on' : '',
        'aria-pressed': String(r.key === range),
        onclick: () => {
          range = r.key;
          refresh();
        },
      }, r.label))),
    mainLiftsCard(from),
    bodyweightCard(from),
    h('h2', null, 'Records'),
    weighted.length > 0 && h('section', { class: 'card' },
      h('h3', null, 'Heaviest lift per exercise'),
      barList(weighted.map(({ ex, rec }) => ({
        label: ex.name,
        value: rec.heaviest.weight,
        text: lift(rec.heaviest),
        onclick: open(ex),
      }))),
    ),
    repsOnly.map(({ ex, rec }) =>
      h('button', { class: 'card', onclick: open(ex) },
        h('div', { class: 'row' }, h('strong', null, ex.name), h('strong', null, lift(rec.mostReps))),
        h('span', { class: 'muted small' }, day(rec.mostReps.date)),
      )),
    !tracked.length && h('p', { class: 'muted' },
      'Finish a workout, or add a past record, to see your best lifts here.'),
    h('button', { class: 'btn', onclick: () => go('progress', 'add') }, '+ Add a record by hand'),
    h('p', { class: 'muted small' }, 'To load many past lifts at once, use More → Export & backup → Import records. To remove them, use More → Records added by hand.'),
  );
}

// Which measure the main lifts chart shows: null for the estimated 1RM of each day's top
// set, or a number of reps for the heaviest set of exactly that many reps.
let repsFilter = null;

// Main lifts switched off in the chart and table (keys from MAIN_LIFTS).
const hiddenLifts = new Set();

function mainLiftsCard(from) {
  const lifts = MAIN_LIFTS.map((main, i) => {
    const ex = state.exercises.find(e => e.main === main.key);
    return { main, ex, color: `var(--series-${i + 1})`, log: ex ? liftLog(ex.id) : [] };
  });

  // Rep counts that have been logged for any main lift, offered as filters.
  const repCounts = [...new Set(lifts.flatMap(l => l.log.flatMap(entry => entry.sets.map(set => set.reps))))]
    .filter(n => n <= 12)
    .sort((a, b) => a - b);
  if (!repCounts.includes(repsFilter)) repsFilter = null;

  const series = lifts.map(({ main, ex, color, log }) => {
    const pullup = main.key === 'pullup';
    const inRange = log.filter(entry => entry.date >= from);
    const points = repsFilter == null
      ? inRange
          .filter(entry => !pullup || entry.bodyweight != null)
          .map(entry => {
            const top = topSet(entry);
            return { date: entry.date, value: round1(estimate1rm(ex.id, top, entry.bodyweight)), lifted: fmtSet(top) };
          })
      : inRange
          .map(entry => ({ date: entry.date, weights: entry.sets.filter(set => set.reps === repsFilter).map(set => set.weight) }))
          .filter(entry => entry.weights.length)
          .map(entry => ({ date: entry.date, value: Math.max(...entry.weights) }));
    return { key: main.key, name: ex?.name ?? main.label, prefix: pullup ? '+' : '', color, points };
  });
  const shown = series.filter(s => !hiddenLifts.has(s.key));

  // Each lift keeps its own colour whether or not the others are shown.
  const liftToggle = s => h('button', {
    class: hiddenLifts.has(s.key) ? '' : 'on',
    'aria-pressed': String(!hiddenLifts.has(s.key)),
    onclick: () => {
      hiddenLifts.has(s.key) ? hiddenLifts.delete(s.key) : hiddenLifts.add(s.key);
      refresh();
    },
  }, h('span', { class: 'line-key', style: `background: ${s.color}` }), s.name);

  const chip = (label, value) => h('button', {
    class: value === repsFilter ? 'on' : '',
    'aria-pressed': String(value === repsFilter),
    onclick: () => {
      repsFilter = value;
      refresh();
    },
  }, label);

  // One row per lift and day, heaviest first (equal weights newest first).
  const rows = shown
    .flatMap(s => s.points.map(point => ({ s, point })))
    .sort((a, b) => b.point.value - a.point.value || b.point.date.localeCompare(a.point.date))
    .map(({ s, point }) => [
      s.name,
      `${s.prefix}${fmtNum(point.value)} kg`,
      // With the estimate, also the set it came from: the weight and reps actually lifted.
      repsFilter == null && point.lifted,
      day(point.date),
    ].filter(cell => cell !== false));
  const headers = repsFilter == null
    ? ['Lift', 'Est. 1RM', 'Lifted', 'Date']
    : ['Lift', `${repsFilter} rep${repsFilter === 1 ? '' : 's'}`, 'Date'];

  return h('section', { class: 'card' },
    h('h3', null, 'Main lifts'),
    h('div', { class: 'chips lifts', role: 'group', 'aria-label': 'Lifts shown' }, series.map(liftToggle)),
    h('div', { class: 'chips', role: 'group', 'aria-label': 'Measure' },
      chip('Est. 1RM', null),
      repCounts.map(n => chip(`${n} rep${n === 1 ? '' : 's'}`, n))),
    h('p', { class: 'muted small' },
      (repsFilter == null
        ? 'Estimated 1RM of the top set.'
        : `Heaviest set of exactly ${repsFilter} rep${repsFilter === 1 ? '' : 's'} each day.`) +
      ' Pull-ups show the weight added to your bodyweight.'),
    rows.length
      ? [trendChart(shown), dataTable(headers, rows)]
      : h('p', { class: 'muted small' },
          shown.length ? 'Nothing logged for these lifts in this time span.' : 'Turn on at least one lift above.'),
  );
}

function bodyweightCard(from) {
  const points = bodyweights().filter(p => p.date >= from);
  if (!points.length) {
    return h('section', { class: 'card' },
      h('h3', null, 'Bodyweight'),
      h('p', { class: 'muted small' }, 'No bodyweight logged in this time span.'));
  }
  const first = points[0], latest = points.at(-1);
  const change = round1(latest.value - first.value);
  return h('section', { class: 'card' },
    h('div', { class: 'row' }, h('h3', null, 'Bodyweight'), h('strong', null, kg(latest.value))),
    points.length > 1 && h('p', { class: 'muted small' },
      change === 0
        ? `No change since ${day(first.date)}`
        : `${change > 0 ? '+' : '−'}${fmtNum(Math.abs(change))} kg since ${day(first.date)}`),
    lineChart(points),
    dataTable(['Date', 'Bodyweight', 'Change'], points.map((point, i) => {
      const diff = i ? round1(point.value - points[i - 1].value) : null;
      return [
        day(point.date),
        kg(point.value),
        diff == null ? '' : diff === 0 ? '0' : `${diff > 0 ? '+' : '−'}${fmtNum(Math.abs(diff))}`,
      ];
    }).reverse()),
  );
}

function exerciseDetail(id) {
  const name = exerciseName(id);
  const back = () => go('progress');
  const add = h('button', { class: 'btn', onclick: () => go('progress', 'add', { exerciseId: id }) },
    '+ Add a record by hand');
  const log = liftLog(id);
  const rec = records(id);
  if (!rec) return page(name, { back }, h('p', { class: 'muted' }, 'No lifts logged yet.'), add);

  // Lifts done without added weight are tracked by reps instead of kilos.
  const weighted = rec.heaviest.weight > 0;
  const pullup = exercise(id)?.main === 'pullup';
  const measure = set => (weighted ? set.weight : set.reps);

  // One point per day: its top set, flagged when it beat every earlier top set.
  let best = -Infinity;
  const tops = log.map(entry => {
    const set = topSet(entry);
    const record = measure(set) > best;
    if (record) best = measure(set);
    return { date: entry.date, value: measure(set), label: lift(set), record, set };
  });
  const latest = tops.at(-1);

  const estimates = log
    .map(entry => ({
      date: entry.date,
      value: round1(Math.max(...entry.sets.map(set => estimate1rm(id, set, entry.bodyweight)))),
    }))
    .filter(point => point.value > 0);

  const tile = (label, value, detail) =>
    h('div', { class: 'tile' },
      h('span', { class: 'muted small' }, label), h('strong', null, value), h('span', { class: 'muted small' }, detail));

  return page(name, { back },
    h('div', { class: 'tiles' },
      weighted
        ? tile('Heaviest', kg(rec.heaviest.weight), `× ${rec.heaviest.reps} · ${day(rec.heaviest.date)}`)
        : tile('Most reps', String(rec.mostReps.reps), day(rec.mostReps.date)),
      rec.best1rm.e1rm > 0 && tile('Est. 1RM', `${pullup ? '+' : ''}${kg(rec.best1rm.e1rm)}`, `from ${fmtSet(rec.best1rm)}`),
      tile('Last top set',
        weighted ? kg(latest.set.weight) : `${latest.set.reps} reps`,
        [
          [weighted && `× ${latest.set.reps}`, latest.set.rpe && `@ ${fmtNum(latest.set.rpe)}`].filter(Boolean).join(' '),
          day(latest.date),
        ].filter(Boolean).join(' · ')),
    ),

    h('section', { class: 'card' },
      h('h3', null, weighted ? 'Top set per session' : 'Top set reps per session'),
      lineChart(tops, { unit: weighted ? 'kg' : 'reps', even: true }),
      tops.length > 1 && h('p', { class: 'muted small key' }, h('span', { class: 'key-dot' }), 'New record'),
      dataTable(
        ['Date', 'Top set', 'Est. 1RM'],
        // Heaviest top set first; equal weights by reps, then newest first.
        log
          .map((entry, i) => ({ entry, top: tops[i] }))
          .sort((a, b) =>
            b.top.set.weight - a.top.set.weight || b.top.set.reps - a.top.set.reps ||
            b.entry.date.localeCompare(a.entry.date))
          .map(({ entry, top }) => {
            const value = round1(Math.max(...entry.sets.map(set => estimate1rm(id, set, entry.bodyweight))));
            return [day(entry.date), top.label + (top.record ? ' ★' : ''), value > 0 ? `${pullup ? '+' : ''}${fmtNum(value)}` : ''];
          }),
      ),
    ),

    estimates.length > 0 && h('section', { class: 'card' },
      h('h3', null, 'Estimated 1RM per session'),
      pullup && h('p', { class: 'muted small' }, 'Weight added to your bodyweight.'),
      lineChart(estimates, { even: true }),
    ),

    add,
    h('h2', null, 'History'),
    [...log].reverse().map(entry =>
      h('div', { class: 'card' },
        h('strong', null, fmtDate(entry.date)),
        entry.manual
          ? entry.manual.map((record, i) =>
              h('div', { class: 'row' },
                h('span', { class: 'muted small' }, `${fmtSet(entry.sets[i])} · added by hand`),
                h('button', {
                  class: 'btn danger compact',
                  onclick: () => {
                    if (!confirm('Delete this record?')) return;
                    deleteRecord(record);
                    refresh();
                  },
                }, 'Delete'),
              ))
          : h('span', { class: 'muted small' }, fmtSets(entry.sets)),
      )),
  );
}

function addRecordPage(exerciseId) {
  let chosen = exerciseId ?? null;
  const back = () => (exerciseId ? go('progress', 'exercise', { id: exerciseId }) : go('progress'));

  const exerciseLabel = h('strong', null, chosen ? exerciseName(chosen) : 'Choose exercise');
  const date = h('input', { type: 'date', value: todayISO(), max: todayISO(), 'aria-label': 'Date' });
  const number = (mode, placeholder) =>
    h('input', { class: 'num', inputMode: mode, autocomplete: 'off', placeholder });
  const weight = number('decimal'), reps = number('numeric'), rpe = number('decimal', 'optional');
  const bodyweight = number('decimal', 'optional');
  const field = (label, input, unit) =>
    h('label', { class: 'card field' }, h('span', null, label), input, unit && h('span', null, unit));

  const save = () => {
    const kilos = parseNum(weight.value);
    const count = Math.round(parseNum(reps.value) ?? 0);
    const effort = parseNum(rpe.value);
    if (!chosen) return toast('Choose an exercise');
    if (!date.value) return toast('Choose a date');
    if (kilos == null || count < 1) return toast('Enter the weight and the reps');
    if (rpe.value.trim() && !validRpe(effort)) return toast('RPE goes from 5 to 10');
    addRecord({
      exerciseId: chosen, date: date.value, weight: kilos, reps: count,
      rpe: rpe.value.trim() ? effort : null, bodyweight: parseNum(bodyweight.value) || null,
    });
    toast('Record added');
    go('progress', 'exercise', { id: chosen });
  };

  return page('Add a record', { back },
    h('button', {
      class: 'card row',
      onclick: () => pickExercise(id => {
        chosen = id;
        exerciseLabel.textContent = exerciseName(id);
      }),
    }, h('span', { class: 'muted' }, 'Exercise'), exerciseLabel),
    field('Date', date),
    field('Weight', weight, 'kg'),
    field('Reps', reps),
    field('Effort (RPE)', rpe),
    field('Bodyweight that day', bodyweight, 'kg'),
    h('p', { class: 'muted small' }, 'Use 0 kg for lifts done with bodyweight only. For pull-ups, enter only the weight you added.'),
    h('button', { class: 'btn primary', onclick: save }, 'Save record'),
  );
}
