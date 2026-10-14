// Current location in the app: a tab, plus an optional sub-page inside it.

export const route = { tab: 'workout', page: null, params: {} };

let render = () => {};

// Asked before leaving the current screen; returning false stays put (unsaved changes).
let leaveCheck = null;

export function onRender(fn) {
  render = fn;
}

export function setLeaveCheck(fn) {
  leaveCheck = fn;
}

// Move to another screen (scrolls to the top).
export function go(tab, page = null, params = {}) {
  if (leaveCheck && !leaveCheck()) return;
  leaveCheck = null;
  Object.assign(route, { tab, page, params });
  render(true);
}

// Redraw the current screen in place, keeping the scroll position.
export function refresh() {
  render(false);
}
