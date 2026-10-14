// The workout editor, used both for the workout in progress and for editing past ones.

import { go, refresh } from '../nav.js';
import {
  addEntry, bodyweightLookup, deleteSession, estimate1rm, exercise, exerciseName, isPR, lastSets,
  newRoutine, newSet, records, saveSession, state, tidy,
} from '../store.js';
import { fmtDate, fmtNum, fmtSet, fmtSets, h, mount, parseNum, toast, validRpe } from '../util.js';
import { page } from './common.js';
import { pickExercise } from './picker.js';

const kg = n => `${fmtNum(Math.round(n * 10) / 10)} kg`;

export function sessionEditor(session) {
  const active = !session.finishedAt;
  const save = () => saveSession(session);

  // Bodyweight is typed at the end of the workout, so until then the last known one is used.
  const knownWeight = bodyweightLookup()(session.date);
  const bodyweight = () => session.bodyweight ?? knownWeight;
  const estimate = (entry, set) => estimate1rm(entry.exerciseId, set, bodyweight());

  const finish = () => {
    if (!session.entries.some(e => e.sets.some(set => set.done))) {
      if (confirm('No sets logged yet. Discard this workout?')) {
        deleteSession(session);
        refresh();
      }
      return;
    }
    const prs = session.entries.filter(entry => {
      const rec = records(entry.exerciseId, session);
      return entry.sets.some(set => isPR(set, rec, estimate(entry, set)));
    }).length;
    tidy(session);
    session.finishedAt = Date.now();
    save();
    toast(prs ? `Workout saved · ${prs} new record${prs > 1 ? 's' : ''}` : 'Workout saved');
    go('history');
  };

  const discard = () => {
    if (!confirm(active ? 'Discard this workout?' : 'Delete this workout? This cannot be undone.')) return;
    deleteSession(session);
    active ? refresh() : go('history');
  };

  const leave = () => {
    if (tidy(session)) {
      save();
    } else {
      deleteSession(session);
      toast('Empty workout removed');
    }
    go('history');
  };

  const saveAsRoutine = () => {
    const sets = {};
    for (const entry of session.entries) sets[entry.exerciseId] = (sets[entry.exerciseId] ?? 0) + entry.sets.length;
    const routine = newRoutine(`Routine ${fmtDate(session.date, { weekday: false })}`, Object.keys(sets), sets);
    go('more', 'routine', { id: routine.id });
  };

  const date = h('input', {
    type: 'date',
    value: session.date,
    'aria-label': 'Workout date',
    onchange: () => {
      if (!date.value) return;
      session.date = date.value;
      save();
      refresh();
    },
  });

  // The hint about top sets is only shown until one has been marked for the first time.
  const showTopHint = !state.sessions.some(s => s.entries.some(e => e.sets.some(set => set.top)));
  const context = { save, estimate, bodyweight };

  return page(active ? 'Workout' : fmtDate(session.date), { back: active ? null : leave, action: date },
    session.entries.map((entry, i) => entryCard(session, entry, context, showTopHint && i === 0)),

    h('button', {
      class: 'btn',
      onclick: () => pickExercise(id => {
        addEntry(session, id);
        save();
        refresh();
      }),
    }, '+ Add exercise'),

    h('label', { class: 'card field' },
      h('span', null, 'Bodyweight'),
      h('input', {
        class: 'num',
        inputMode: 'decimal',
        autocomplete: 'off',
        placeholder: knownWeight == null ? '' : fmtNum(knownWeight),
        value: session.bodyweight == null ? '' : fmtNum(session.bodyweight),
        oninput: e => {
          session.bodyweight = parseNum(e.target.value);
          save();
        },
        // Pull-up estimates above depend on it, so redraw once the number is complete.
        onchange: refresh,
      }),
      h('span', null, 'kg'),
    ),

    h('textarea', {
      rows: 2,
      placeholder: 'Notes',
      value: session.notes,
      oninput: e => {
        session.notes = e.target.value;
        save();
      },
    }),

    active
      ? h('button', { class: 'btn primary', onclick: finish }, 'Finish workout')
      : h('button', { class: 'btn', onclick: saveAsRoutine }, 'Save as routine'),
    h('button', { class: 'btn danger', onclick: discard }, active ? 'Discard workout' : 'Delete workout'),
  );
}

function entryCard(session, entry, context, showTopHint) {
  const { save } = context;
  const name = exerciseName(entry.exerciseId);
  const last = lastSets(entry.exerciseId, session);
  const rec = records(entry.exerciseId, session);

  // What a set is expected to be: the same set from last time, else the previous set today.
  const hint = i =>
    last?.sets[Math.min(i, last.sets.length - 1)] ??
    entry.sets.slice(0, i).reverse().find(set => set.reps != null) ??
    null;

  const remove = () => {
    if (entry.sets.some(set => set.reps != null) && !confirm(`Remove ${name} from this workout?`)) return;
    session.entries.splice(session.entries.indexOf(entry), 1);
    save();
    refresh();
  };

  return h('section', { class: 'card' },
    h('div', { class: 'row' },
      h('h3', null, name),
      h('button', { class: 'icon', 'aria-label': `Remove ${name}`, onclick: remove }, '✕'),
    ),
    last && h('p', { class: 'muted small' },
      `Last time (${fmtDate(last.date, { weekday: false })}): ${fmtSets(last.sets)}`),
    rec && h('p', { class: 'muted small' }, `Best: ${fmtSet(rec.heaviest)}`),
    h('div', { class: 'set head' },
      h('span', null, 'Set'), h('span', null, 'kg'), h('span', null, 'Reps'), h('span', null, '@ RPE'), h('span'), h('span')),
    entry.sets.map((set, i) => setRow(entry, set, i, { ...context, hint, rec })),
    showTopHint && h('p', { class: 'muted small' }, 'Tap a set number to mark it ★ as your top set.'),
    h('button', {
      class: 'btn ghost',
      onclick: () => {
        entry.sets.push(newSet());
        save();
        refresh();
      },
    }, '+ Add set'),
  );
}

// The line under a main lift's top set: its estimated 1RM, or what is missing to work it out.
function estimateLine(main, set, value, bodyweight) {
  if (set.reps == null || (set.weight == null && main !== 'pullup')) {
    return ['Fill in the weight and reps to see the estimated 1RM.'];
  }
  if (set.reps === 0) return ['Missed attempt, so no estimated 1RM.'];
  if (main !== 'pullup') return ['Estimated 1RM ', h('strong', null, kg(value))];
  if (bodyweight == null) return ['Enter your bodyweight below to see the estimated 1RM.'];
  return [
    'Estimated 1RM ', h('strong', null, `+${kg(value)}`),
    ` added (${kg(value + bodyweight)} in total at ${kg(bodyweight)} bodyweight)`,
  ];
}

function setRow(entry, set, i, { hint, rec, save, estimate, bodyweight }) {
  const main = exercise(entry.exerciseId)?.main;
  const expected = hint(i);
  const field = (label, mode, value, placeholder) => h('input', {
    class: 'num',
    inputMode: mode,
    autocomplete: 'off',
    'aria-label': `Set ${i + 1} ${label}`,
    value: value == null ? '' : fmtNum(value),
    placeholder: placeholder == null ? '' : fmtNum(placeholder),
  });
  // Reps to suggest from a set: what was done, or what was planned if that set was missed.
  const suggestedReps = from => from?.reps || from?.target || null;

  const weight = field('weight in kg', 'decimal', set.weight, expected?.weight);
  const reps = field('reps', 'numeric', set.reps, suggestedReps(expected));
  const rpe = field('effort (RPE, 5 to 10)', 'decimal', set.rpe, null);
  const check = h('button', { class: 'check', 'aria-label': `Set ${i + 1} done` }, '✓');

  // Tapping the set number marks it as the exercise's top set (one per exercise).
  const index = h('button', {
    class: 'idx',
    onclick: () => {
      const mark = !set.top;
      for (const other of entry.sets) other.top = false;
      set.top = mark;
      save();
      refresh();
    },
  });

  const row = h('div', { class: 'set' },
    index, weight, reps, rpe, check,
    h('button', {
      class: 'icon',
      'aria-label': `Delete set ${i + 1}`,
      onclick: () => {
        entry.sets.splice(i, 1);
        save();
        refresh();
      },
    }, '✕'),
  );
  const estimated = h('p', { class: 'estimate small', hidden: true });

  // Shown under a failed set: how many reps were planned.
  const target = h('input', {
    class: 'num',
    inputMode: 'numeric',
    autocomplete: 'off',
    'aria-label': `Set ${i + 1} planned reps`,
    oninput: () => {
      const n = parseNum(target.value);
      set.target = n ? Math.round(n) : null;
      save();
    },
  });
  const missed = h('label', { class: 'estimate missed small', hidden: true }, 'Failed · aimed for', target, 'reps');

  // Rows update in place so typing never loses focus.
  const paint = () => {
    const value = estimate(entry, set);
    const pr = isPR(set, rec, value);
    row.classList.toggle('done', set.done);
    row.classList.toggle('skipped', !set.done && set.reps != null);
    row.classList.toggle('top', !!set.top);
    mount(index, h('span', null, set.top ? '★' : i + 1), pr && h('small', null, 'PR'));
    index.setAttribute('aria-label',
      `Set ${i + 1}${set.top ? ', top set' : ''}${pr ? ', new record' : ''}. Tap to ${set.top ? 'unmark' : 'mark'} as top set`);
    const failed = set.done && !!set.failed;
    row.classList.toggle('failed', failed);
    check.textContent = failed ? '✗' : '✓';
    check.setAttribute('aria-label',
      `Set ${i + 1}: ${failed ? 'failed' : set.done ? 'done' : 'not done'}. Tap to change (done, failed, not done)`);
    check.setAttribute('aria-pressed', set.done);
    missed.hidden = !failed;
    if (failed && document.activeElement !== target) target.value = set.target ?? '';
    estimated.hidden = !(set.top && main);
    if (!estimated.hidden) mount(estimated, estimateLine(main, set, value, bodyweight()));
  };

  rpe.addEventListener('input', () => {
    const n = parseNum(rpe.value);
    set.rpe = validRpe(n) ? n : null;
    // "1" is left alone because it is how typing "10" starts.
    rpe.classList.toggle('invalid', !['', '1'].includes(rpe.value.trim()) && !validRpe(n));
    paint();
    save();
  });

  weight.addEventListener('input', () => {
    set.weight = parseNum(weight.value);
    paint();
    save();
  });

  // Entering reps completes the set, taking the suggested weight if none was typed.
  // 0 reps is a missed attempt: a failed set that keeps how many reps were planned.
  reps.addEventListener('input', () => {
    const n = parseNum(reps.value);
    set.reps = n == null ? null : Math.round(n);
    set.done = set.reps != null;
    if (!set.done) set.failed = false;
    const from = hint(i);
    if (set.reps === 0) {
      set.failed = true;
      set.target ??= suggestedReps(from) ?? 1;
    } else if (set.failed && set.target != null && set.reps >= set.target) {
      // Reaching the planned reps means the set was not failed after all.
      set.failed = false;
    }
    if (set.done && set.weight == null && from?.weight != null) {
      set.weight = from.weight;
      weight.value = fmtNum(set.weight);
    }
    paint();
    save();
  });

  // The tick cycles: not done -> done (accepting the suggested numbers) -> failed -> not done.
  // A missed attempt (0 reps) is always failed, so it goes straight back to not done.
  check.addEventListener('click', () => {
    if (set.done && !set.failed) {
      set.failed = true;
      // Keep a planned number from before only if it is still more than was done.
      const planned = suggestedReps(hint(i));
      if (!(set.target > set.reps)) set.target = planned > set.reps ? planned : set.reps + 1;
    } else if (set.done) {
      set.done = false;
      set.failed = false;
    } else {
      const from = hint(i);
      set.weight ??= from?.weight ?? null;
      set.reps ??= suggestedReps(from);
      if (set.weight != null) weight.value = fmtNum(set.weight);
      if (set.reps == null) {
        reps.focus();
        return;
      }
      reps.value = set.reps;
      set.done = true;
      if (set.reps === 0) set.failed = true;
    }
    paint();
    save();
  });

  paint();
  return [row, missed, estimated];
}
