import { go, refresh } from '../nav.js';
import { chronological, exerciseName, routineName, sessionStats, sessionTopSets, state } from '../store.js';
import { fmtDate, fmtNum, fmtSet, h, isoDate, mount, todayISO } from '../util.js';
import { page } from './common.js';
import { sessionEditor } from './session.js';

export function historyView(route) {
  if (route.page === 'session') {
    const session = state.sessions.find(s => s.id === route.params.id);
    if (session) return sessionEditor(session);
  }

  const sessions = chronological().reverse();
  if (!sessions.length) {
    return page('History', {}, h('p', { class: 'muted' }, 'Finished workouts will show up here.'));
  }

  // Only the list is redrawn while typing, so the search box keeps the keyboard.
  const list = h('div', { class: 'page' });
  const draw = () => {
    const words = normalize(query).split(/\s+/).filter(Boolean);
    const found = sessions.filter(session => {
      const text = searchText(session);
      return words.every(word => text.includes(word));
    });
    mount(list,
      words.length > 0 && h('p', { class: 'muted small' },
        `${found.length} of ${sessions.length} workout${sessions.length === 1 ? '' : 's'}`),
      mode === 'calendar'
        ? calendar(found, draw)
        : found.length ? found.map(sessionCard) : h('p', { class: 'muted' }, 'No workouts match that search.'),
    );
  };
  draw();

  const modeButton = (key, label) => h('button', {
    class: key === mode ? 'on' : '',
    'aria-pressed': String(key === mode),
    onclick: () => {
      mode = key;
      refresh();
    },
  }, label);

  return page('History', {},
    h('div', { class: 'segmented', role: 'group', 'aria-label': 'Show workouts as' },
      modeButton('list', 'List'), modeButton('calendar', 'Calendar')),
    h('input', {
      type: 'search',
      value: query,
      placeholder: 'Search exercise, weekday or routine',
      autocomplete: 'off',
      'aria-label': 'Search workouts',
      oninput: e => {
        query = e.target.value;
        // The calendar jumps to the newest workout the search finds.
        month = picked = null;
        draw();
      },
    }),
    list,
  );
}

// What was typed in the search box, the list or calendar view, the month shown ('YYYY-MM')
// and the day picked on it; kept while the app stays open.
let query = '';
let mode = 'list';
let month = null;
let picked = null;

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// A month grid where the days with a workout (among those the search found) are marked.
// Tapping one lists its workouts under the grid.
function calendar(found, redraw) {
  month ??= (found[0]?.date ?? todayISO()).slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const byDate = new Map();
  for (const s of found) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
  const inMonth = found.filter(s => s.date.startsWith(month));

  const shift = step => () => {
    month = isoDate(new Date(y, m - 1 + step, 1)).slice(0, 7);
    picked = null;
    redraw();
  };
  const days = new Date(y, m, 0).getDate();
  const blanks = (new Date(y, m - 1, 1).getDay() + 6) % 7; // Monday first
  const today = todayISO();

  const cells = Array.from({ length: days }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, '0')}`;
    const count = byDate.get(date)?.length ?? 0;
    return h('button', {
      class: ['cal-day', count && 'has', date === picked && 'on', date === today && 'today'].filter(Boolean).join(' '),
      disabled: !count,
      'aria-label': `${fmtDate(date)}${count ? `, ${count} workout${count === 1 ? '' : 's'}` : ''}`,
      onclick: () => {
        picked = picked === date ? null : date;
        redraw();
      },
    }, String(i + 1));
  });

  const title = new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const shown = picked?.startsWith(month) ? byDate.get(picked) ?? [] : [];
  return [
    h('section', { class: 'card calendar' },
      h('div', { class: 'row' },
        h('button', { class: 'cal-nav', 'aria-label': 'Previous month', onclick: shift(-1) }, '‹'),
        h('strong', null, title),
        h('button', { class: 'cal-nav', 'aria-label': 'Next month', onclick: shift(1) }, '›'),
      ),
      h('div', { class: 'cal-grid' },
        WEEKDAYS.map(d => h('span', { class: 'cal-head' }, d.slice(0, 1))),
        Array.from({ length: blanks }, () => h('span')),
        cells,
      ),
      h('p', { class: 'muted small' },
        inMonth.length
          ? `${inMonth.length} workout${inMonth.length === 1 ? '' : 's'} this month · tap a day to see it`
          : 'No workouts this month.'),
    ),
    shown.map(sessionCard),
  ];
}

// Lower case without accents, so "miercoles" finds "miércoles".
const normalize = text => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Everything a workout can be found by: its exercises, routine, weekday (English and
// Spanish) and date as shown on the card.
function searchText(session) {
  const [y, m, d] = session.date.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return normalize([
    ...session.entries.map(e => exerciseName(e.exerciseId)),
    routineName(session.routineId) ?? '',
    date.toLocaleDateString('en-GB', { weekday: 'long' }),
    date.toLocaleDateString('es-ES', { weekday: 'long' }),
    fmtDate(session.date),
  ].join(' '));
}

function sessionCard(session) {
  const { sets } = sessionStats(session);
  const tops = sessionTopSets(session);
  const routine = routineName(session.routineId);
  const exercises = [...new Set(session.entries.map(e => exerciseName(e.exerciseId)))];
  return h('button', { class: 'card', onclick: () => go('history', 'session', { id: session.id }) },
    h('div', { class: 'row' },
      h('strong', null, routine ? `${fmtDate(session.date)} · ${routine}` : fmtDate(session.date)),
      session.bodyweight != null && h('span', { class: 'muted small' }, `BW ${fmtNum(session.bodyweight)} kg`),
    ),
    h('span', { class: 'muted small' }, exercises.join(' · ')),
    // Top set of each main lift done that day; workouts without one just show the set count.
    tops.length
      ? tops.map(({ exercise, set }) =>
          h('span', { class: 'small' }, h('strong', null, exercise.name), ` ${fmtSet(set)}`))
      : h('span', { class: 'small' }, `${sets} set${sets === 1 ? '' : 's'}`),
  );
}
