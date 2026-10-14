import { activeExercises, addExercise } from '../store.js';
import { h, mount } from '../util.js';

// Full-screen exercise chooser with search; typing a new name offers to create it.
export function pickExercise(onPick) {
  const overlay = document.getElementById('overlay');
  const close = () => mount(overlay);
  const choose = id => {
    close();
    onPick(id);
  };

  const list = h('div', { class: 'sheet-list' });
  const search = h('input', {
    type: 'search',
    placeholder: 'Search or type a new exercise',
    autocomplete: 'off',
    'aria-label': 'Search exercises',
  });

  const draw = () => {
    const name = search.value.trim();
    const query = name.toLowerCase();
    const matches = activeExercises().filter(e => e.name.toLowerCase().includes(query));
    const exact = matches.some(e => e.name.toLowerCase() === query);
    mount(list,
      name && !exact && h('button', { class: 'option create', onclick: () => choose(addExercise(name).id) },
        `Create “${name}”`),
      matches.map(e => h('button', { class: 'option', onclick: () => choose(e.id) }, e.name)),
    );
  };
  search.addEventListener('input', draw);
  draw();

  mount(overlay,
    h('div', { class: 'sheet' },
      h('div', { class: 'sheet-head' }, search, h('button', { class: 'btn ghost', onclick: close }, 'Cancel')),
      list,
    ),
  );
}
