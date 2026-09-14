const DEFAULTS = {
  enabled: true,
  showBars: true,
  showPopout: true,
  minLikes: 0,
  cooldown: 30,
  duration: 6,
  windowSec: 0,
};

const TOGGLES = ['enabled', 'showPopout'];
const NUMBERS = ['minLikes', 'cooldown'];
const CACHE_KEY = 'scrubber:comments';

const el = (id) => document.getElementById(id);

async function send(msg) {
  try {
    const tabs = await ScrubberApi.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (!tab || tab.id == null) return null;
    return await ScrubberApi.tabs.sendMessage(tab.id, msg);
  } catch (_) {
    return null; // not a YouTube tab, or the content script isn't there yet
  }
}

// What it found on this video. The number keeps climbing while the background
// sweep runs, so it is re-read rather than shown once.
function paintStats(stats) {
  const on = !!(stats && stats.onWatch);
  const count = el('count');
  count.textContent = '';
  if (on) {
    const n = document.createElement('b');
    n.textContent = String(stats.comments);
    count.append(n, document.createTextNode(
      stats.comments === 1 ? ' timed comment' : ' timed comments'));
  } else {
    count.textContent = 'no video open';
  }
  el('loadMore').disabled = !on;
}

function paintSub() {
  el('minLikesRow').classList.toggle('off', !el('showPopout').checked);
}

async function init() {
  const cfg = await ScrubberApi.get(DEFAULTS);

  for (const k of TOGGLES) {
    el(k).checked = !!cfg[k];
    el(k).addEventListener('change', () => {
      ScrubberApi.set({ [k]: el(k).checked });
      send({ type: 'scrubber:config', cfg: { [k]: el(k).checked } });
      paintSub();
    });
  }

  for (const k of NUMBERS) {
    el(k).value = cfg[k];
    el(k).addEventListener('change', () => {
      const v = Math.max(0, parseInt(el(k).value, 10) || 0);
      el(k).value = v;
      ScrubberApi.set({ [k]: v });
      send({ type: 'scrubber:config', cfg: { [k]: v } });
    });
  }
  paintSub();

  // How wide a stretch a hover gathers comments from. Zero means the extension
  // scales it with the video's length, which is the right answer often enough to
  // be the default.
  const win = el('windowSec');
  const paintWin = () => {
    const v = Number(win.value) || 0;
    el('windowVal').textContent = v ? v + 's' : 'Auto';
  };
  win.value = cfg.windowSec || 0;
  paintWin();
  win.addEventListener('input', paintWin);
  win.addEventListener('change', () => {
    const v = Math.max(0, parseInt(win.value, 10) || 0);
    ScrubberApi.set({ windowSec: v });
    send({ type: 'scrubber:config', cfg: { windowSec: v } });
  });

  el('loadMore').addEventListener('click', async () => {
    const btn = el('loadMore');
    btn.disabled = true;
    btn.textContent = 'Loading…';
    const res = await send({ type: 'scrubber:loadMore' });
    btn.textContent = res ? `Found ${res.added} more` : 'Load more comments';
    paintStats(await send({ type: 'scrubber:stats' }));
    setTimeout(() => { btn.textContent = 'Load more comments'; btn.disabled = false; }, 1800);
  });

  // A day of comments for forty videos lives in local storage; this is the way
  // to throw it away. The page keeps whatever it has already found until it is
  // reloaded, which is why it says so.
  el('clearCache').addEventListener('click', async () => {
    const btn = el('clearCache');
    btn.disabled = true;
    try {
      await ScrubberApi.localSet(CACHE_KEY, {});
      btn.textContent = 'Cleared — reload the video';
    } catch (_) {
      btn.textContent = 'Could not clear it';
    }
    setTimeout(() => { btn.textContent = 'Clear cached comments'; btn.disabled = false; }, 2200);
  });

  paintStats(await send({ type: 'scrubber:stats' }));
  // The sweep is still running behind this window; keep the count honest.
  setInterval(async () => paintStats(await send({ type: 'scrubber:stats' })), 1500);
}

init();
