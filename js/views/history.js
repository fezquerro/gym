import { go } from '../nav.js';
import { chronological, exerciseName, routineName, sessionStats, sessionTopSets, state } from '../store.js';
import { fmtDate, fmtNum, fmtSet, h, mount } from '../util.js';
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
      found.length ? found.map(sessionCard) : h('p', { class: 'muted' }, 'No workouts match that search.'),
    );
  };
  draw();

  return page('History', {},
    h('input', {
      type: 'search',
      value: query,
      placeholder: 'Search exercise, weekday or routine',
      autocomplete: 'off',
      'aria-label': 'Search workouts',
      oninput: e => {
        query = e.target.value;
        draw();
      },
    }),
    list,
  );
}

// What was typed in the search box; kept while the app stays open.
let query = '';

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
