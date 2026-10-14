// Single-series line chart drawn as SVG, with a crosshair readout on hover or touch.

import { fmtDate, fmtNum, h, mount } from './util.js';

const NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  el.append(...children);
  return el;
}

function niceTicks(min, max, count = 3) {
  const span = max - min || Math.max(1, Math.abs(max) * 0.1);
  const raw = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(f => f * magnitude).find(s => s >= raw);
  let lo = Math.floor(min / step) * step;
  let hi = Math.ceil(max / step) * step;
  if (lo === hi) {
    lo -= step;
    hi += step;
  }
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(6)));
  return ticks;
}

const dayNumber = iso => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};

// Horizontal bars comparing one value across named items, longest first.
// items: [{ label, value, text, onclick }]
export function barList(items) {
  const max = Math.max(...items.map(item => item.value));
  return h('div', { class: 'bars' },
    [...items].sort((a, b) => b.value - a.value).map(item =>
      h('button', { class: 'bar-row', onclick: item.onclick },
        h('span', { class: 'bar-label' }, item.label),
        h('span', { class: 'bar-track' },
          h('span', { class: 'bar-fill', style: `--share: ${item.value / max}` }),
          h('span', { class: 'bar-value' }, item.text),
        ),
      )),
  );
}

// Several series on one calendar axis, with the legend doubling as the readout: it shows
// each series' latest value, or its value up to the date under the pointer.
// series: [{ name, color, prefix?, points: [{ date, value }] }], points oldest first.
// `prefix` goes in front of that series' values in the readout (e.g. "+").
export function trendChart(series, { unit = 'kg' } = {}) {
  const all = series.flatMap(s => s.points);
  const when = h('p', { class: 'muted small' });
  const legend = h('div', { class: 'legend' });

  const readout = date => {
    when.textContent = date ? `Up to ${fmtDate(date)}` : 'Latest';
    mount(legend, series.map(s => {
      const point = date ? s.points.filter(p => p.date <= date).at(-1) : s.points.at(-1);
      return h('span', { class: 'legend-item' },
        h('span', { class: 'line-key', style: `background: ${s.color}` }),
        h('span', { class: 'muted' }, s.name),
        h('strong', null, point ? `${s.prefix ?? ''}${fmtNum(point.value)} ${unit}` : '–'),
      );
    }));
  };
  readout(null);

  const dates = [...new Set(all.map(p => p.date))].sort();
  if (dates.length < 2) {
    return h('div', { class: 'chart' }, when, legend,
      h('p', { class: 'muted small' }, 'The chart appears once there are two sessions to compare.'));
  }

  const W = 340, H = 180;
  const box = { left: 36, right: W - 12, top: 12, bottom: H - 24 };
  const ticks = niceTicks(Math.min(...all.map(p => p.value)), Math.max(...all.map(p => p.value)), 4);
  const lo = ticks[0], hi = ticks.at(-1);
  const first = dayNumber(dates[0]);
  const days = dayNumber(dates.at(-1)) - first;
  const x = date => box.left + ((dayNumber(date) - first) / days) * (box.right - box.left);
  const y = v => box.bottom - ((v - lo) / (hi - lo)) * (box.bottom - box.top);

  const lines = series.filter(s => s.points.length).map(s => ({
    ...s,
    pts: s.points.map(p => ({ ...p, x: x(p.date), y: y(p.value) })),
    marker: svg('circle', { class: 'chart-dot', r: 4, style: `fill: ${s.color}`, visibility: 'hidden' }),
  }));
  const text = (attrs, content) => svg('text', { class: 'chart-text', ...attrs }, content);
  const cross = svg('line', { class: 'chart-cross', y1: box.top, y2: box.bottom, visibility: 'hidden' });

  const plot = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Line chart of ${lines.map(l => l.name).join(', ')}` },
    ...ticks.map(t => svg('line', { class: 'chart-grid', x1: box.left, x2: box.right, y1: y(t), y2: y(t) })),
    ...ticks.map(t => text({ x: box.left - 6, y: y(t) + 3.5, 'text-anchor': 'end' }, fmtNum(t))),
    text({ x: box.left, y: H - 6 }, fmtDate(dates[0], { weekday: false })),
    text({ x: box.right, y: H - 6, 'text-anchor': 'end' }, fmtDate(dates.at(-1), { weekday: false })),
    cross,
    ...lines.map(l => svg('path', {
      class: 'chart-line',
      style: `stroke: ${l.color}`,
      d: l.pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '),
    })),
    ...lines.map(l => svg('circle', { class: 'chart-dot', r: 4, style: `fill: ${l.color}`, cx: l.pts.at(-1).x, cy: l.pts.at(-1).y })),
    ...lines.map(l => l.marker),
  );

  const show = event => {
    const rect = plot.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * W;
    const date = dates.reduce((best, d) => (Math.abs(x(d) - px) < Math.abs(x(best) - px) ? d : best));
    cross.setAttribute('x1', x(date));
    cross.setAttribute('x2', x(date));
    cross.setAttribute('visibility', 'visible');
    for (const line of lines) {
      const p = line.pts.filter(q => q.date <= date).at(-1);
      line.marker.setAttribute('visibility', p ? 'visible' : 'hidden');
      if (p) {
        line.marker.setAttribute('cx', p.x);
        line.marker.setAttribute('cy', p.y);
      }
    }
    readout(date);
  };
  plot.addEventListener('pointerdown', show);
  plot.addEventListener('pointermove', show);
  plot.addEventListener('pointerleave', event => {
    if (event.pointerType !== 'mouse') return;
    cross.setAttribute('visibility', 'hidden');
    lines.forEach(line => line.marker.setAttribute('visibility', 'hidden'));
    readout(null);
  });

  return h('div', { class: 'chart' }, when, legend, plot);
}

// points: [{ date: 'YYYY-MM-DD', value, label?, record? }], oldest first.
// `label` replaces the value in the readout. When points carry `record`, a dot is drawn
// on each record-setting point instead of on the latest one.
// `even` spaces the points equally (one step per session) instead of by calendar date.
export function lineChart(points, { unit = 'kg', even = false } = {}) {
  if (points.length < 2) {
    return h('p', { class: 'muted small' }, 'The chart appears once there are two sessions to compare.');
  }

  const W = 340, H = 170;
  const box = { left: 36, right: W - 52, top: 30, bottom: H - 24 };
  const ticks = niceTicks(Math.min(...points.map(p => p.value)), Math.max(...points.map(p => p.value)));
  const lo = ticks[0], hi = ticks.at(-1);
  const first = dayNumber(points[0].date);
  const days = dayNumber(points.at(-1).date) - first || 1;

  const share = (p, i) => (even ? i / (points.length - 1) : (dayNumber(p.date) - first) / days);
  const y = v => box.bottom - ((v - lo) / (hi - lo)) * (box.bottom - box.top);
  const pts = points.map((p, i) => ({ ...p, x: box.left + share(p, i) * (box.right - box.left), y: y(p.value) }));
  const last = pts.at(-1);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  const text = (attrs, content) => svg('text', { class: 'chart-text', ...attrs }, content);
  const cross = svg('line', { class: 'chart-cross', y1: box.top, y2: box.bottom, visibility: 'hidden' });
  const marker = svg('circle', { class: 'chart-dot', r: 4, visibility: 'hidden' });

  const plot = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Line chart, latest ${fmtNum(last.value)} ${unit}` },
    ...ticks.map(t => svg('line', { class: 'chart-grid', x1: box.left, x2: box.right, y1: y(t), y2: y(t) })),
    ...ticks.map(t => text({ x: box.left - 6, y: y(t) + 3.5, 'text-anchor': 'end' }, fmtNum(t))),
    text({ x: box.left, y: H - 6 }, fmtDate(points[0].date, { weekday: false })),
    text({ x: box.right, y: H - 6, 'text-anchor': 'end' }, fmtDate(last.date, { weekday: false })),
    svg('path', { class: 'chart-area', d: `${path} L${last.x.toFixed(1)} ${box.bottom} L${pts[0].x.toFixed(1)} ${box.bottom} Z` }),
    svg('path', { class: 'chart-line', d: path }),
    cross,
    ...(points.some(p => 'record' in p) ? pts.filter(p => p.record) : [last])
      .map(p => svg('circle', { class: 'chart-dot', cx: p.x, cy: p.y, r: 4 })),
    svg('text', { class: 'chart-text chart-value', x: last.x + 8, y: last.y + 4 }, fmtNum(last.value)),
    marker,
  );

  const tip = h('div', { class: 'chart-tip', hidden: true });
  const hide = () => {
    tip.hidden = true;
    cross.setAttribute('visibility', 'hidden');
    marker.setAttribute('visibility', 'hidden');
  };
  const show = event => {
    const rect = plot.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * W;
    const p = pts.reduce((best, q) => (Math.abs(q.x - px) < Math.abs(best.x - px) ? q : best));
    cross.setAttribute('x1', p.x);
    cross.setAttribute('x2', p.x);
    cross.setAttribute('visibility', 'visible');
    marker.setAttribute('cx', p.x);
    marker.setAttribute('cy', p.y);
    marker.setAttribute('visibility', 'visible');
    mount(tip, h('strong', null, p.label ?? `${fmtNum(p.value)} ${unit}`), h('span', null, fmtDate(p.date)));
    tip.hidden = false;
    const percent = (p.x / W) * 100;
    tip.style.left = `${percent}%`;
    tip.style.transform = `translateX(${percent > 65 ? '-100%' : percent < 35 ? '0' : '-50%'})`;
  };
  plot.addEventListener('pointerdown', show);
  plot.addEventListener('pointermove', show);
  // A touch readout stays up after the finger lifts; a mouse readout follows the pointer out.
  plot.addEventListener('pointerleave', event => {
    if (event.pointerType === 'mouse') hide();
  });

  return h('div', { class: 'chart' }, plot, tip);
}
