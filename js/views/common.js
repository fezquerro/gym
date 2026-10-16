import { fmtNum, h } from '../util.js';

// A fold-out table with the same numbers as the chart above it. rows: arrays of cell text.
export function dataTable(headers, rows) {
  return h('details', { class: 'table' },
    h('summary', null, 'Show as table'),
    h('div', { class: 'table-scroll' },
      h('table', null,
        h('thead', null, h('tr', null, headers.map(text => h('th', null, text)))),
        h('tbody', null, rows.map(row => h('tr', null, row.map(cell => h('td', null, cell))))),
      ),
    ),
  );
}

// A table cell that shows the bodyweight of that day when tapped, if one was logged.
export function bodyweightCell(text, bodyweight) {
  if (bodyweight == null) return text;
  const extra = h('span', { class: 'cell-extra', hidden: true }, `BW ${fmtNum(bodyweight)} kg`);
  return h('button', {
    class: 'cell-tap',
    onclick: () => { extra.hidden = !extra.hidden; },
  }, h('span', { class: 'cell-value' }, text), extra);
}

// Standard screen layout: a title bar (with optional back button and right-side action) over content.
// With a back button the bar stays at the top while scrolling.
export function page(title, { back, action } = {}, ...children) {
  return h('div', { class: 'page' },
    h('header', { class: back ? 'bar sticky' : 'bar' },
      back && h('button', { class: 'back', 'aria-label': 'Back', onclick: back }, '‹'),
      h('h1', null, title),
      action,
    ),
    children,
  );
}
