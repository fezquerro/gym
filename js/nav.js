// Current location in the app: a tab, plus an optional sub-page inside it.

export const route = { tab: 'workout', page: null, params: {} };

let render = () => {};

export function onRender(fn) {
  render = fn;
}

// Move to another screen (scrolls to the top).
export function go(tab, page = null, params = {}) {
  Object.assign(route, { tab, page, params });
  render(true);
}

// Redraw the current screen in place, keeping the scroll position.
export function refresh() {
  render(false);
}
