// Shared background-job runner: one interval, one state blob, one log, one
// persisted auto flag per job. Extracted from converter.jsx so any service can
// schedule work the same way (convert, tracking, design check…).

const POLL_MS = 60_000;

export function createJob({ name, storageKey, runOnce, pollMs = POLL_MS }) {
  let intervalId = null;
  const state = {
    name,
    enabled: false,
    running: false,
    paused: false,
    lastTickAt: null,
    nextTickAt: null,
    pending: [],
    pendingCount: 0,
    processedTotal: 0,
    errorTotal: 0,
    log: [],
  };
  const listeners = new Set();

  function snapshot() {
    return { ...state, log: state.log.slice(0, 200), pending: state.pending.slice(0, 200) };
  }
  function emit() {
    const s = snapshot();
    listeners.forEach((fn) => { try { fn(s); } catch { /* noop */ } });
  }
  function pushLog(level, system_id, key, message) {
    state.log.unshift({ ts: Date.now(), level, system_id, key, message });
    if (state.log.length > 200) state.log.length = 200;
  }

  async function tick() {
    if (state.running) return;
    state.running = true;
    state.lastTickAt = Date.now();
    emit();
    try {
      await runOnce({ state, pushLog, emit });
    } catch (err) {
      if (err?.response?.status === 403) {
        pushLog('error', null, null, 'Convert mode disabled by server (403). Stopping.');
        stop();
        return;
      }
      pushLog('error', null, null, err?.message || 'Poll error');
      console.warn(`[${name}] poll error`, err);
    } finally {
      state.running = false;
      state.nextTickAt = state.enabled && !state.paused ? Date.now() + pollMs : null;
      emit();
    }
  }

  function softStop() {
    // Stop timers and reset live state without touching the persisted auto
    // flag. Used by AuthContext on logout so the next login can restore the
    // user's previous on/off choice.
    state.enabled = false;
    state.paused = false;
    state.running = false;
    state.nextTickAt = null;
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
    emit();
  }
  function start() {
    state.enabled = true;
    try { localStorage.setItem(storageKey, '1'); } catch { /* noop */ }
    if (!intervalId) {
      intervalId = setInterval(() => { if (!state.paused) tick(); }, pollMs);
    }
    state.nextTickAt = Date.now() + 1500;
    emit();
    setTimeout(() => { if (!state.paused) tick(); }, 1500);
  }
  function stop() {
    // User-initiated stop — also clears the persisted auto flag so the next
    // login does NOT auto-start this job.
    try { localStorage.setItem(storageKey, '0'); } catch { /* noop */ }
    softStop();
  }
  function pause() { state.paused = true; emit(); }
  function resume() {
    if (!state.enabled) return;
    state.paused = false;
    emit();
    if (!state.running) tick();
  }
  function runNow() {
    if (!state.enabled || state.running) return;
    tick();
  }
  function isAutoEnabled() {
    try { return localStorage.getItem(storageKey) === '1'; } catch { return false; }
  }
  function subscribe(fn) {
    listeners.add(fn);
    fn(snapshot());
    return () => listeners.delete(fn);
  }

  return {
    subscribe, start, stop, softStop, pause, resume, runNow, isAutoEnabled,
    // Exposed so callers (e.g. manual one-off conversions) can push entries
    // into the job's activity log without going through tick().
    pushLog: (level, system_id, key, message) => { pushLog(level, system_id, key, message); emit(); },
    bumpProcessed: () => { state.processedTotal += 1; emit(); },
    bumpError: () => { state.errorTotal += 1; emit(); },
    // Mutate state from outside (e.g. seed a list from the server) + re-emit.
    patchState: (fn) => { fn(state); emit(); },
  };
}
