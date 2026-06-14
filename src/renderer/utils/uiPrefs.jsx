// Per-machine UI preferences (saved in localStorage). Currently: whether the
// sidebar shows the logo and the app name. Settings writes them and dispatches
// 'ui-prefs-changed' so the Layout updates live.
const KEY = 'ui_prefs';
const DEFAULTS = { showLogo: true, showAppName: true };

export function getUiPrefs() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setUiPrefs(patch) {
  const next = { ...getUiPrefs(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new Event('ui-prefs-changed'));
  return next;
}
