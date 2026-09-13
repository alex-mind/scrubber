/* Cross-browser WebExtension API shim.
 *
 * Safari and Firefox expose a promise-based `browser.*`. Chrome MV3 exposes
 * `chrome.*`, which also returns promises as long as you don't pass a callback.
 * So: pick the namespace once, never pass callbacks, and await everything.
 */
var ScrubberApi = (() => {
  'use strict';

  const ns =
    (typeof browser !== 'undefined' && browser && browser.runtime) ? browser :
    (typeof chrome !== 'undefined' && chrome && chrome.runtime) ? chrome : null;

  // storage.sync is not guaranteed everywhere (and can be disabled by policy).
  // Resolve lazily so a throwing getter doesn't take the whole script down.
  function area() {
    try {
      if (ns.storage && ns.storage.sync) return ns.storage.sync;
    } catch (_) { /* fall through */ }
    return ns.storage.local;
  }

  return {
    ok: !!ns,
    ns,
    runtime: ns && ns.runtime,
    tabs: ns && ns.tabs,

    async get(defaults) {
      try {
        const v = await area().get(defaults);
        return { ...defaults, ...(v || {}) };
      } catch (_) {
        return { ...defaults };
      }
    },

    async set(obj) {
      try { await area().set(obj); } catch (_) { /* best effort */ }
    },

    // Settings live in `sync` where the quota is tiny. The comment cache is far
    // too big for that, so it gets `local` explicitly rather than the fallback.
    async localGet(key) {
      try {
        const area = ns.storage && ns.storage.local;
        if (!area) return null;
        const v = await area.get(key);
        return (v && v[key]) || null;
      } catch (_) {
        return null;
      }
    },

    async localSet(key, value) {
      try {
        const area = ns.storage && ns.storage.local;
        if (!area) return;
        await area.set({ [key]: value });
      } catch (_) { /* over quota, or no local area: the cache is optional */ }
    },

    onChanged(fn) {
      try { ns.storage.onChanged.addListener(fn); } catch (_) { /* unsupported */ }
    },
  };
})();
