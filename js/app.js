import { go, onRender, route } from './nav.js';
import { flush, load } from './store.js';
import { h, mount, toast } from './util.js';
import { historyView } from './views/history.js';
import { moreView } from './views/more.js';
import { progressView } from './views/progress.js';
import { workoutView } from './views/workout.js';

const views = { workout: workoutView, history: historyView, progress: progressView, more: moreView };
const view = document.getElementById('view');
const tabs = document.querySelectorAll('#tabs button');

onRender(resetScroll => {
  const y = window.scrollY;
  mount(view, views[route.tab](route));
  tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.tab === route.tab));
  window.scrollTo(0, resetScroll ? 0 : y);
});

tabs.forEach(tab => tab.addEventListener('click', () => go(tab.dataset.tab)));

// Write out pending edits whenever the app goes to the background.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) flush();
});
window.addEventListener('pagehide', flush);
window.addEventListener('unhandledrejection', event => {
  toast(`Something went wrong: ${event.reason?.message ?? event.reason}`);
});

try {
  await load();
  go('workout');
} catch (err) {
  mount(view, h('p', { class: 'muted' }, `Could not open the database: ${err.message}`));
}

// Ask the browser not to evict the data when storage runs low.
navigator.storage?.persist?.();

// No service worker on localhost (unless ?sw is in the URL) so edits show up immediately while developing.
const developing = location.hostname === 'localhost' && !location.search.includes('sw');
if ('serviceWorker' in navigator && !developing) {
  navigator.serviceWorker.register('sw.js');
}
