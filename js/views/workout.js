import { refresh } from '../nav.js';
import { activeSession, routineSummary, startSession, state } from '../store.js';
import { h } from '../util.js';
import { page } from './common.js';
import { sessionEditor } from './session.js';

export function workoutView() {
  const active = activeSession();
  if (active) return sessionEditor(active);

  const start = routine => {
    startSession(routine);
    refresh();
  };

  return page('Workout', {},
    h('button', { class: 'btn primary', onclick: () => start() }, 'Start empty workout'),
    h('h2', null, 'Routines'),
    state.routines.length
      ? state.routines.map(routine =>
          h('button', { class: 'card', onclick: () => start(routine) },
            h('strong', null, routine.name || 'Untitled routine'),
            h('span', { class: 'muted small' },
              routineSummary(routine) || 'No exercises yet'),
          ))
      : h('p', { class: 'muted' },
          'No routines yet. Create one in More → Routines, or finish a workout and save it as a routine.'),
  );
}
