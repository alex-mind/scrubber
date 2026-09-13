/* Scrubber — timeline comments for YouTube.
 *
 * Reads the timestamps people already type into YouTube comments, draws them as
 * density marks over the progress bar, and surfaces the good ones as you watch.
 * Works on desktop (www.youtube.com) and mobile web (m.youtube.com), in Chrome
 * and Safari. No network calls. Nothing leaves the browser but your settings.
 */
(() => {
  'use strict';

  if (!ScrubberApi.ok) return;

  // Every instance keeps its own state but they all find the same stack element
  // by selector, so a second copy of this script silently doubles every card and
  // fights the first over hiding the preview. Only the first one runs.
  const docRoot = document.documentElement;
  if (docRoot.hasAttribute('data-scrubber-on')) return;
  docRoot.setAttribute('data-scrubber-on', '1');

  const DEFAULTS = {
    enabled: true,
    showBars: true,
    showPopout: true,
    minLikes: 0,
    cooldown: 30,
    duration: 6,
    windowSec: 0,
  };

  const BUCKETS = 160;
  const BUCKET_PX = 6;
  const BUCKET_MIN_SEC = 1.5;
  const BAR_SCALE = 0.7;
  const CHART_SCALE = 0.62;
  const TOP_BAR_HEIGHT = 0.3;
  const FILL_LEAD = 2.5;
  const TIP_ROWS = 6;
  const ROW_GAP = 7;
  const HEAD_H = 16;
  const TIP_FIT = 3;
  const TIP_CHROME = 50;
  const TIP_MIN_H = 76;
  const ROW_PAD = 3;      // .st-rows' own padding, which the rows sit inside
  const OPEN_GRACE = 1100;   // the panel's own padding and footer, off the rows
  const HINT_H = 34;
  const CARD_REPLIES = 20;
  const REPLY_PAGE = 20;
  const COUNT_MIN = 4;
  const MAX_CARDS = 3;
  const OVERFLOW_ROWS = 40;
  const DEEP_PAGES = 6;
  const DEEP_ROUNDS = 6;
  const DEEP_GAP = 500;
  const SWEEP_DELAY = 2500;
  const PAGES_FIRST = 7;
  const PAGES_REFRESH = 2;
  const CACHE_KEY = 'scrubber:comments';
  // Bump when the stored tuple changes shape.
  const CACHE_SHAPE = 2;
  const CACHE_TTL = 24 * 60 * 60 * 1000;
  const CACHE_VIDEOS = 40;
  const CACHE_PER_VIDEO = 400;
  const CACHE_BODY = 600;
  const PENDING_GRACE = 3;
  const POPOUT_LAG = 2.5;
  const WINDOW_FRACTION = 0.04;
  const WINDOW_MIN = 8;
  const WINDOW_MAX = 120;
  const MOBILE_LIKE_FACTOR = 3;
  const MOBILE_LIKE_FLOOR = 3;
  const TAG_MIN = 15;
  const END_GAP = 4;
  const TOP_SLOTS = 7;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const likeTargets = new WeakMap();
  const replyTargets = new WeakMap();

  // A name is a person, and people are worth a look. Marked as a link only where
  // we actually know where it points; opened in its own tab, never in place,
  // because the video is still playing here.
  function nameEl(cls, text, path) {
    const el = document.createElement('span');
    el.className = cls;
    el.textContent = text || '';
    if (path) {
      el.classList.add('is-who');
      el.dataset.who = path;
      el.setAttribute('role', 'link');
      el.setAttribute('title', 'Open ' + (text || 'this channel'));
    }
    return el;
  }

  function openAuthor(node) {
    const path = node && node.dataset && node.dataset.who;
    if (!path) return false;
    try {
      window.open(location.origin + path, '_blank', 'noopener,noreferrer');
    } catch (_) { return false; }
    return true;
  }
  let cfg = { ...DEFAULTS };
  let dom = ScrubberDom.pick();
  let S = null;

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // A fixed ten seconds is a wide selection on a three-minute video and a sliver
  // on an hour-long one. Scale it with the video, clamped at both ends, unless a
  // number is pinned in the settings.
  function windowSpan() {
    if (cfg.windowSec > 0) return cfg.windowSec;
    const d = (S && S.duration) || 0;
    return d ? clamp(d * WINDOW_FRACTION, WINDOW_MIN, WINDOW_MAX) : WINDOW_MIN;
  }

  // A card costs more attention on a phone, where it covers much more of the
  // picture, so the bar to earn one is higher there.
  function likeFloor() {
    return dom.name === 'mobile'
      ? Math.max(cfg.minLikes * MOBILE_LIKE_FACTOR, MOBILE_LIKE_FLOOR)
      : cfg.minLikes;
  }

  // A comment about a moment is a reaction to it, so its card lands once the
  // moment has played rather than the instant the playhead reaches it — which
  // was handing you the punchline on the way in.
  function showTime(m) {
    if (m.top) return m.t;
    const end = (S && S.duration ? S.duration : m.t) - 0.5;
    return Math.min(m.t + POPOUT_LAG, Math.max(m.t, end));
  }

  function inRect(r, x, y, pad) {
    if (!r) return false;
    pad = pad || 0;
    return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
  }

  function videoId() {
    try { return new URL(location.href).searchParams.get('v'); } catch (_) { return null; }
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  // Comments almost always open with the timestamp they are about ("5:38 this
  // joke kills"), and every surface already shows that time in its own column.
  // Strip it — but only when it is the very timestamp being displayed, so a
  // comment listing several stamps keeps the ones we aren't captioning.
  function trimLeadStamp(body, t) {
    const m = body.match(/^\s*\(?(?:(\d{1,2}):)?(\d{1,3}):([0-5]\d)\)?\s*[-–—:|)\]]?\s*/);
    if (!m) return body;
    const lead = (m[1] ? +m[1] : 0) * 3600 + (+m[2]) * 60 + (+m[3]);
    if (lead !== t) return body;
    return body.slice(m[0].length).trim() || body;
  }

  function compactCount(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K';
    return String(n);
  }

  // YouTube enforces Trusted Types on this origin, so innerHTML throws — the
  // icon is assembled node by node like everything else here.
  function likeChip(n, mark) {
    const wrap = document.createElement('span');
    wrap.className = 'sp-likes';
    const action = mark && mark.like;
    if (!n && !action) return wrap;       // YouTube hides the count at zero too
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    // Its own size, in the markup: with the stylesheet missing an SVG with only
    // a viewBox draws at the intrinsic default, which is 300x150 of speech
    // bubble across the video.
    svg.setAttribute('width', '13');
    svg.setAttribute('height', '13');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('d', 'M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z');
    svg.appendChild(path);
    const c = document.createElement('span');
    c.textContent = compactCount(n);
    wrap.append(svg, c);
    if (action) {
      wrap.classList.add('can-like');
      wrap.setAttribute('role', 'button');
      wrap.setAttribute('title', 'Like this comment');
      likeTargets.set(wrap, mark);
    }
    return wrap;
  }

  // Opening a card is opening the comment: the whole text, and the conversation
  // under it, in place. It holds its own countdown while it is open — you asked
  // for it, so it waits for you.
  // Opening a card gives you the comment in full, the conversation under it and
  // somewhere to answer — the same thing the panel gives you, on the card.
  function expandCard(card) {
    const el = card.el;
    const full = !el.classList.contains('is-full');
    el.classList.toggle('is-full', full);
    if (!full) {
      for (const sel of ['.sp-thread', '.sp-compose']) {
        const n = el.querySelector(':scope > ' + sel);
        if (n) n.remove();
      }
      el.classList.remove('is-composing');
      card.thread = null;
      resumeCard(card, 'open');
      avoidPreview(dom.player());
      return;
    }
    holdCard(card, 'open');
    const stack = el.parentNode;
    if (stack && stack.scrollTo) {
      // Opened cards grow downward from their top edge, so keep that edge in view.
      setTimeout(() => { if (el.offsetTop !== undefined) stack.scrollTop = el.offsetTop - 8; }, 0);
    }
    loadCardThread(card);
    if (card.mark.replyTo) {
      el.classList.add('is-composing');
      openCompose({
        host: el, mark: card.mark, before: el.querySelector(':scope > .sp-timer'),
        cancel: () => expandCard(card),
      });
    }
    avoidPreview(dom.player());
  }

  function cardThreadBox(card) {
    const el = card.el;
    let wrap = el.querySelector(':scope > .sp-thread');
    if (wrap) return wrap;
    wrap = document.createElement('div');
    wrap.className = 'sp-thread';
    // Above the reply box, which is where the conversation ends.
    el.insertBefore(wrap, el.querySelector(':scope > .sp-compose') ||
      el.querySelector(':scope > .sp-timer'));
    return wrap;
  }

  async function loadCardThread(card) {
    const el = card.el;
    if (!card.thread) card.thread = { items: [], next: card.mark.replies || null };
    const token = card.thread.next;
    if (!token || typeof ScrubberFeed === 'undefined') return;
    card.thread.next = null;                       // one request in flight at a time

    const wrap = cardThreadBox(card);
    const note = document.createElement('div');
    note.className = 'sp-tnote';
    note.textContent = 'loading replies\u2026';
    wrap.appendChild(note);

    const res = await ScrubberFeed.replies(token, CARD_REPLIES);
    // Closed again, or the card went, while we were waiting.
    if (!el.parentNode || !el.classList.contains('is-full')) { note.remove(); return; }
    card.thread.items = card.thread.items.concat(res && res.ok ? res.items : []);
    card.thread.next = res && res.ok ? (res.next || null) : null;
    wrap.textContent = '';
    const items = card.thread.items;
    if (!items.length) {
      wrap.remove();
      return;
    }
    for (const r of items) {
      const row = document.createElement('div');
      row.className = 'sp-treply';
      const head = document.createElement('div');
      head.className = 'st-head';
      const a = nameEl('st-ra', r.author, r.authorPath);
      const gap = document.createElement('span');
      gap.className = 'sp-gap';
      const sub = { replyN: parseCount(r.replies), replyTo: r.replyParams || null,
        like: r.likeAction, likes: parseCount(r.likes) };
      head.append(a, gap, replyChip(sub), likeChip(sub.likes, sub));
      const c = document.createElement('div');
      c.className = 'sp-tc';
      c.textContent = r.body || '';
      row.append(head, c);
      wrap.appendChild(row);
    }

    // The rest of a long thread, on the card as in the panel.
    const left = Math.max(0, (card.mark.replyN || 0) - items.length);
    if (card.thread.next && left) {
      const more = document.createElement('button');
      more.className = 'sp-more';
      more.type = 'button';
      more.textContent = 'View more (' + compactCount(left) + ')';
      more.addEventListener('click', (e) => { e.stopPropagation(); loadCardThread(card); });
      wrap.appendChild(more);
    }
    avoidPreview(dom.player());
  }

  // The moment the reply is about. Captured when the composer opens rather than
  // when it is sent, because the video keeps playing while you type and the
  // stamp should name what you were answering, not where the video got to.
  function composeStamp(mark) {
    if (mark && !mark.top && typeof mark.t === 'number') return mark.t;
    const v = dom.video();
    return v ? v.currentTime : 0;
  }

  // Builds the composer inside `host`. `hold` and `free` are how the caller
  // stops whatever clock it runs on while the viewer is typing.
  // One composer, two jobs: answering a comment, and writing one of your own
  // about the moment under the cursor. Both post the timestamp in front of the
  // text, and neither sends anything until its own button is pressed.
  function openCompose(o) {
    const host = o.host, mark = o.mark, verb = o.verb || 'Reply';
    const wrap = document.createElement('div');
    wrap.className = 'sp-compose';
    const at = Math.max(0, Math.floor(o.at !== undefined ? o.at : composeStamp(mark)));

    const box = document.createElement('textarea');
    box.className = 'sp-input';
    box.rows = 2;
    box.placeholder = verb === 'Post' ? 'Comment at ' + fmtTime(at) + '\u2026' : 'Reply\u2026';
    box.setAttribute('aria-label', verb === 'Post' ? 'Your comment' : 'Your reply');
    // YouTube listens for single keys on the document — without this, typing a
    // space pauses the video and 'f' goes full screen.
    for (const ev of ['keydown', 'keypress', 'keyup']) {
      box.addEventListener(ev, (e) => e.stopPropagation());
    }
    const row = document.createElement('div');
    row.className = 'sp-crow';
    // The stamp is shown because it is going to be posted: no surprises about
    // what leaves the browser.
    const stamp = document.createElement('span');
    stamp.className = 'sp-cstamp';
    stamp.textContent = fmtTime(at);
    stamp.setAttribute('title', 'Posted in front of what you write');
    const note = document.createElement('span');
    note.className = 'sp-cnote';
    const send = document.createElement('button');
    send.className = 'sp-send';
    send.type = 'button';
    send.textContent = verb;
    send.addEventListener('click', (e) => {
      e.stopPropagation();
      sendWrite(o, at, box, send, note, () => {
        if (wrap.parentNode) wrap.remove();
        if (o.free) o.free();
      });
    });
    row.append(stamp, note);
    // A way out of it: opening a reply box should never be a one-way door.
    if (o.cancel) {
      const cancel = document.createElement('button');
      cancel.className = 'sp-cancel';
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', (e) => { e.stopPropagation(); o.cancel(); });
      row.appendChild(cancel);
    }
    row.appendChild(send);
    wrap.append(box, row);

    host.insertBefore(wrap, o.before || null);
    if (o.hold) o.hold();
    box.focus();
    return wrap;
  }

  async function sendWrite(o, at, box, send, note, done) {
    const typed = (box.value || '').trim();
    if (!typed || send.disabled) return;
    if (typeof ScrubberFeed === 'undefined') return;
    const newComment = o.verb === 'Post';
    if (!newComment && !(o.mark && o.mark.replyTo)) return;
    // The whole point of this extension is that a comment belongs to a moment,
    // so anything posted from it says which moment it belongs to. YouTube turns
    // a leading stamp into a link by itself.
    const text = fmtTime(at) + ' ' + typed;
    send.disabled = true;
    note.textContent = 'Sending\u2026';
    const res = newComment
      ? await ScrubberFeed.create(text)
      : await ScrubberFeed.reply(o.mark.replyTo, text);
    if (res && res.ok) {
      note.textContent = 'Posted';
      box.disabled = true;
      setTimeout(() => { if (done) done(); }, 1400);
      return;
    }
    send.disabled = false;
    note.textContent = (res && res.reason === 'not signed in')
      ? 'Sign in to post' : 'Could not post';
  }

  // How many people answered it. A comment with a thread under it is a different
  // thing from a comment nobody replied to, and the count is the cheapest way to
  // say which this is.
  function replyChip(mark) {
    const n = mark && mark.replyN;
    const can = !!(mark && mark.replyTo);
    const wrap = document.createElement('span');
    wrap.className = 'sp-replies';
    if (!n && !can) return wrap;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    // Its own size, in the markup: with the stylesheet missing an SVG with only
    // a viewBox draws at the intrinsic default, which is 300x150 of speech
    // bubble across the video.
    svg.setAttribute('width', '13');
    svg.setAttribute('height', '13');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('d', 'M20 4H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3v3.2L11.6 18H20a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z');
    svg.appendChild(path);
    const c = document.createElement('span');
    c.textContent = n ? compactCount(n) : '';
    wrap.append(svg, c);
    // The same chip that says how many answers there are is the way to add one.
    if (can) {
      wrap.classList.add('can-reply');
      wrap.setAttribute('role', 'button');
      wrap.setAttribute('title', n ? 'Reply \u00b7 ' + n + ' already' : 'Reply');
      replyTargets.set(wrap, mark);
    } else {
      wrap.setAttribute('title', n + (n === 1 ? ' reply' : ' replies'));
    }
    return wrap;
  }

  // Sends the like YouTube's own button would send, and only ever from a click.
  // There is no un-like: the action string is specifically a like, so a chip
  // retires once it has been used.
  async function doLike(chip) {
    const mark = likeTargets.get(chip);
    if (!mark || !mark.like || typeof ScrubberFeed === 'undefined') return;
    if (chip.classList.contains('busy') || chip.classList.contains('liked')) return;
    chip.classList.add('busy');
    const res = await ScrubberFeed.like(mark.like);
    chip.classList.remove('busy');
    if (!res.ok) {
      chip.classList.add('failed');
      setTimeout(() => chip.classList.remove('failed'), 1400);
      return;
    }
    chip.classList.add('liked');
    likeTargets.delete(chip);
    mark.likes = (mark.likes || 0) + 1;
    const n = chip.children[1];
    if (n) n.textContent = compactCount(mark.likes);
  }

  function parseCount(txt) {
    if (!txt) return 0;
    const s = String(txt).trim().replace(/[\s, ]/g, '');
    const m = s.match(/^([\d.]+)([KMB])?$/i);
    if (!m) return 0;
    let n = parseFloat(m[1]);
    if (!isFinite(n)) return 0;
    const suf = (m[2] || '').toUpperCase();
    if (suf === 'K') n *= 1e3;
    else if (suf === 'M') n *= 1e6;
    else if (suf === 'B') n *= 1e9;
    return Math.round(n);
  }

  const HMS = /(?:^|[^\d:])(?:(\d{1,2}):)?(\d{1,3}):([0-5]\d)(?![\d:])/g;

  function secondsFromHref(href) {
    if (!href) return null;
    const m = href.match(/[?&]t=(\d+)s?/);
    return m ? parseInt(m[1], 10) : null;
  }

  // During an ad YouTube reuses the same <video> element, so its duration is the
  // ad's. Reading it then would throw away every mark on the real video.
  function contentDuration() {
    if (dom.adShowing()) return 0;
    const v = dom.video();
    const d = v && v.duration;
    return isFinite(d) && d > 1 ? d : 0;
  }

  // ----------------------------------------------------------- comment scan
  // One comment, from either source — the rendered DOM or YouTube's API — into
  // marks. Both paths come through here, so the same body cannot land twice.
  function ingest(rec) {
    if (!S || !rec || !rec.body) return 0;
    const body = rec.body;
    const author = rec.author || '';
    const likes = rec.likes;

    const key = `${author}::${body.slice(0, 90)}`;
    if (S.seen.has(key)) return 0;
    S.seen.add(key);
    // Kept in the compact shape the cache stores, so writing it back is free.
    S.raw.push([body.slice(0, CACHE_BODY), author, likes, rec.stamps || [],
      rec.replyToken || null, rec.likeAction || null, rec.replyParams || null,
      rec.replyCount || 0, rec.authorPath || null]);

    const set = new Set(rec.stamps || []);
    if (set.size === 0) {
      HMS.lastIndex = 0;
      let m;
      while ((m = HMS.exec(body)) !== null) {
        set.add((m[1] ? +m[1] : 0) * 3600 + (+m[2]) * 60 + (+m[3]));
      }
    }
    // No timecode is not the same as no value — these are just not about any one
    // moment, so the best of them are held back for the end of the video.
    if (set.size === 0) {
      S.top.push({ body, author, likes, replyToken: rec.replyToken || null,
        like: rec.likeAction || null, replyTo: rec.replyParams || null,
        replyN: rec.replyCount || 0, who: rec.authorPath || null });
      S.schedule = null;
      return 0;
    }

    // A comment listing a whole index of timestamps is a table of contents or
    // a study log, not a reaction to a moment.
    if (set.size > 8) return 0;

    S.comments++;
    let added = 0;
    const n = set.size;
    for (const t of set) {
      if (t < 0 || t > 86400) continue;   // real bound comes from duration, at render time
      S.marks.push({ t, text: body, author, likes, n,
        replies: rec.replyToken || null, like: rec.likeAction || null,
        replyTo: rec.replyParams || null, replyN: rec.replyCount || 0,
        who: rec.authorPath || null });
      added++;
    }
    return added;
  }

  function absorb(added) {
    if (!S || !added) return 0;
    S.schedule = null;
    S.marks.sort((a, b) => a.t - b.t);
    renderDensity();
    return added;
  }

  function scanComments() {
    if (!S) return 0;
    let added = 0;

    for (const th of dom.threads()) {
      const p = dom.parts(th);
      if (!p.body) continue;
      const body = (p.body.innerText || p.body.textContent || '').trim();
      if (!body) continue;

      // Prefer YouTube's own timestamp anchors — it already decided these are
      // timecodes, and the href survives both layouts unchanged.
      const stamps = [];
      for (const a of p.body.querySelectorAll('a[href]')) {
        const t = secondsFromHref(a.getAttribute('href'));
        if (t !== null) stamps.push(t);
      }
      added += ingest({ body, author: p.author, likes: parseCount(p.likes), stamps });
    }
    return absorb(added);
  }

  // --------------------------------------------------------------- density
  function inRange() {
    const dur = S && S.duration;
    return dur ? S.marks.filter((m) => m.t < dur) : [];
  }

  // How finely to carve the bar. A mark should be wide enough to see and to aim
  // at, so the count follows the pixels available rather than the duration
  // alone, and never cuts the video finer than a moment you could distinguish.
  // A short video therefore gets fewer, chunkier marks instead of a row of
  // slivers, and a wide player does not get sub-pixel ones.
  function bucketCount() {
    const dur = S.duration || 1;
    const host = dom.progressHost();
    const px = host ? host.getBoundingClientRect().width : 0;
    const byPixels = px ? Math.round(px / BUCKET_PX) : BUCKETS;
    const byTime = Math.round(dur / BUCKET_MIN_SEC);
    return clamp(Math.min(byPixels, byTime), 20, BUCKETS);
  }

  function bucketize() {
    const dur = S.duration || 1;
    const n = bucketCount();
    const counts = new Array(n).fill(0);
    const weights = new Array(n).fill(0);
    const tops = new Array(n).fill(0);
    // A comment with no timecode of its own still gets a slot in the video, so
    // the bar says where — otherwise it arrives out of nowhere.
    for (const m of schedule()) {
      if (!m.top) continue;
      tops[clamp(Math.floor((m.t / dur) * n), 0, n - 1)]++;
    }
    for (const m of inRange()) {
      const i = clamp(Math.floor((m.t / dur) * n), 0, n - 1);
      counts[i]++;
      // Likes count, but on a square root: a stretch with several liked comments
      // should out-rank one runaway comment, and nothing should flatten the rest
      // of the bar into nothing.
      weights[i] += Math.sqrt(Math.max(0, m.likes) + 1);
    }
    return { counts, weights, tops };
  }

  // Everything in the window around one moment, best first — and the window
  // itself, recorded, because several things downstream describe it.
  function nearAt(t) {
    const half = windowSpan() / 2;
    S.tipWin = { lo: Math.max(0, t - half), hi: Math.min(S.duration, t + half) };
    S.tipT = t;
    // Comments with no timecode of their own are given a slot and a mark on the
    // bar, so they have to be findable at that slot too — a mark you can see and
    // hover and get nothing from is just a bug with a tooltip.
    return inRange().concat(schedule().filter((m) => m.top))
      .filter((m) => Math.abs(m.t - t) <= half)
      .sort((a, b) => b.likes - a.likes);
  }

  // An extension that reloads under an open tab leaves the page running our
  // script with the stylesheet the old copy injected — which Safari drops. What
  // is left is our markup with no styling at all: icons at their intrinsic size,
  // panels as bare text. Cheap to detect, since our own custom property stops
  // resolving, and cheap to fix.
  function ensureStyles(player) {
    if (!player) return;
    let styled = true;
    try {
      styled = getComputedStyle(player).getPropertyValue('--sc').trim() !== '';
    } catch (_) { return; }
    if (styled) return;
    if (document.querySelector('link[data-scrubber-css]')) return;
    let href = null;
    try {
      href = ScrubberApi.runtime && ScrubberApi.runtime.getURL &&
        ScrubberApi.runtime.getURL('src/content.css');
    } catch (_) { href = null; }
    if (!href) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute('data-scrubber-css', '1');
    (document.head || document.documentElement).appendChild(link);
  }

  function densityEl() {
    const player = dom.player();
    return player ? player.querySelector('.scrubber-density') : null;
  }

  // On videos with "most replayed" data YouTube draws a curve in its own
  // container. Rather than measuring that box and floating above it, the marks
  // are moved *into* it as its first child: they then inherit the chart's exact
  // geometry, and YouTube's own SVG paints over them, so the white line stays on
  // top and the marks read as part of the same graphic.
  // A video without "most replayed" data still gets the container — at zero
  // height, forever. Parenting into that hides the marks outright, so a chart
  // only counts as one if it actually carries a curve.
  function chartNode() {
    const player = dom.player();
    const cont = player && player.querySelector('.ytp-heat-map-container, .ytp-heat-map-chart');
    if (!cont) return null;
    for (const path of cont.querySelectorAll('path')) {
      if ((path.getAttribute('d') || '').length > 8) return cont;
    }
    return null;
  }

  // Living inside the chart is also how the marks inherit its visibility: when
  // YouTube folds the curve away the marks go with it, animation and all, with
  // nothing here to keep in sync.
  function densityHome(host) {
    const hm = chartNode();
    return hm ? { node: hm, chart: true } : { node: host, chart: false };
  }

  function chartShowing() {
    const hm = chartNode();
    if (!hm) return false;
    const r = hm.getBoundingClientRect();
    return r.height >= 6 && r.width >= 40;
  }

  // A video with a curve but the curve folded away shows nothing at all, which
  // is right until there is a lot to miss. Past that, one compact tag on the bar.
  function renderTag(host) {
    if (!S || !host) return;
    let tag = host.querySelector(':scope > .scrubber-tag');
    const total = inRange().length;
    const show = cfg.enabled && cfg.showBars && chartNode() && !chartShowing() && total >= TAG_MIN;
    if (!show) {
      if (tag) tag.remove();
      return;
    }
    if (!tag) {
      tag = document.createElement('div');
      tag.className = 'scrubber-tag';
      host.appendChild(tag);
    }
    tag.textContent = '\uD83D\uDCAC ' + total;
  }

  function renderDensity() {
    if (!S) return;
    const host = dom.progressHost();
    if (!host) return;

    let el = densityEl();
    if (!cfg.enabled || !cfg.showBars || !S.duration || inRange().length === 0) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.className = 'scrubber-density';
      if (dom.name === 'mobile') el.classList.add('is-mobile');
    }
    syncAccent(dom.player());

    const home = densityHome(host);
    if (el.parentNode !== home.node) {
      el.classList.toggle('in-chart', home.chart);
      // First child, so YouTube's curve paints on top of the marks.
      home.node.insertBefore(el, home.node.firstChild);
    }
    renderTag(host);

    const { counts, weights, tops } = bucketize();
    const maxW = Math.max(...weights, 1);
    // Comments keep arriving for a second or two after a video opens, so the
    // marks grow in over that stretch rather than snapping into place.
    const fresh = Date.now() < (S.freshUntil || 0);
    const frag = document.createDocumentFragment();
    const inChart = el.classList.contains('in-chart');

    counts.forEach((c, i) => {
      const bar = document.createElement('i');
      // sqrt keeps a single lonely mark visible next to a spike of thirty
      // A slot holding only an untimed comment gets a short, plain mark: it says
      // "one lands here" without claiming this is a busy moment.
      const onlyTop = c === 0 && tops[i] > 0;
      let frac = c === 0
        ? (onlyTop ? TOP_BAR_HEIGHT * BAR_SCALE : 0)
        : Math.max(0.09, Math.sqrt(weights[i] / maxW)) * BAR_SCALE;
      if (onlyTop) bar.classList.add('is-untimed');
      // Inside the chart the marks are measured against the chart's own box, at
      // a fraction of it — related to the curve's scale without being trapped
      // under the curve, which flattened every mark in a quiet stretch to
      // nothing and made the loud ones all the same height.
      if (inChart && frac > 0) frac = Math.max(0.05, frac) * CHART_SCALE;
      bar.style.height = Math.round(frac * 100) + '%';
      if (weights[i] >= maxW * 0.6 && c > 1) bar.classList.add('hot');
      if (c > 0 || onlyTop) {
        bar.dataset.n = String(c || tops[i]);
        if (fresh) bar.style.animationDelay = (i * 6) + 'ms';
      }
      frag.appendChild(bar);
    });

    el.textContent = '';
    el.classList.toggle('is-fresh', fresh);
    el.appendChild(frag);
    // Absolutely positioned, so they sit outside the flex row of bars.
    const win = document.createElement('div');
    win.className = 'scrubber-window';
    el.appendChild(win);
    S.winRange = null;
  }

  // The hovered bar is found from the cursor's time, not from the event target:
  // a bucket is only a few pixels wide, and giving the overlay pointer events
  // would put it between you and YouTube's own scrubbing.
  function paintBarHints(host, t) {
    if (!S || !S.duration) return;
    let el = densityEl();
    if (!el) return;
    // The curve can arrive after the marks did. Moving home is not enough then:
    // the bars were sized without it, so they are rebuilt against it.
    if (el.parentNode !== densityHome(host).node) {
      renderDensity();
      el = densityEl();
      if (!el) return;
    }

    const half = windowSpan() / 2;
    const lo = t - half;
    const hi = t + half;

    // A selection only means something where there is something to select.
    const nearby = inRange().some((m) => m.t >= lo && m.t <= hi);
    const win = el.querySelector('.scrubber-window');
    if (win) {
      const a = clamp(lo / S.duration, 0, 1) * 100;
      const b = clamp(hi / S.duration, 0, 1) * 100;
      // A few px proud of the span it marks, so the end caps sit outside the
      // marks rather than on top of them.
      win.style.left = 'calc(' + a + '% - 3px)';
      win.style.width = 'calc(' + Math.max(0.3, b - a) + '% + 6px)';
      win.classList.toggle('on', nearby);
    }

    // Everything inside the selection lifts, not just the bar under the cursor.
    const bars = el.querySelectorAll(':scope > i');
    if (!bars.length) return;
    const total = bars.length;
    const from = clamp(Math.floor((lo / S.duration) * total), 0, total - 1);
    const to = clamp(Math.ceil((hi / S.duration) * total), 0, total - 1);
    const key = from + ':' + to;
    if (S.winRange === key) return;
    if (S.winRange) {
      const prev = S.winRange.split(':').map(Number);
      for (let i = prev[0]; i <= prev[1]; i++) if (bars[i]) bars[i].classList.remove('is-lit');
    }
    S.winRange = key;
    for (let i = from; i <= to; i++) if (bars[i]) bars[i].classList.add('is-lit');
  }

  // A mark answers for its own comments: it fills as their moment comes up, is
  // full at the instant the first card appears, stays full while any of them is
  // on screen, and drains once the last one has gone.
  function barSchedule(n) {
    const key = n + ':' + S.marks.length + ':' + (S.schedule ? S.schedule.length : 0);
    if (S.barKey === key) return S.barMap;
    const dur = S.duration || 1;
    const map = new Map();
    for (const m of schedule()) {
      const i = clamp(Math.floor((m.t / dur) * n), 0, n - 1);
      if (!map.has(i)) map.set(i, []);
      map.get(i).push(m);
    }
    S.barKey = key;
    S.barMap = map;
    return map;
  }

  function paintBarFill(t) {
    if (!S || !S.duration) return;
    const el = densityEl();
    if (!el) return;
    const bars = el.querySelectorAll(':scope > i');
    if (!bars.length) return;

    for (const [i, marks] of barSchedule(bars.length)) {
      const bar = bars[i];
      if (!bar) continue;

      // The fill is a tally, not a gate: it counts how many of this mark's
      // comments have had their turn, so it reaches the top as the last of them
      // appears rather than holding them all back until it gets there.
      let done = 0;
      let next = Infinity;
      for (const m of marks) {
        const at = showTime(m);
        if (at <= t) done++;
        else if (at < next) next = at;
      }
      const live = S.cards.some((c) => marks.indexOf(c.mark) !== -1);

      let f;
      if (done >= marks.length) {
        // All said. Full while any of them is still up, then it drains.
        f = live ? 1 : 0;
      } else {
        // Between comments it creeps toward the next one, so the mark is always
        // a little ahead of the card it is about to hand over.
        const lead = next - t <= FILL_LEAD ? clamp(1 - (next - t) / FILL_LEAD, 0, 1) : 0;
        f = (done + lead) / marks.length;
      }

      // A comment landing gives its mark a beat of its own.
      if (done > (bar.__done || 0) && done > 0) {
        bar.classList.remove('is-pop');
        void bar.offsetWidth;                   // restart the animation
        bar.classList.add('is-pop');
        clearTimeout(bar.__pop);
        bar.__pop = setTimeout(() => bar.classList.remove('is-pop'), 420);
      }
      bar.__done = done;

      f = Math.round(f * 40) / 40;
      if (bar.__f === f) continue;
      bar.__f = f;
      bar.style.setProperty('--f', String(f));
      bar.classList.toggle('is-filling', f > 0);
    }
  }

  function clearBarHints() {
    const el = densityEl();
    if (!el) return;
    const win = el.querySelector('.scrubber-window');
    if (win) win.classList.remove('on');
    const bars = el.querySelectorAll(':scope > i');
    if (S && S.winRange) {
      const prev = S.winRange.split(':').map(Number);
      for (let i = prev[0]; i <= prev[1]; i++) if (bars[i]) bars[i].classList.remove('is-lit');
      S.winRange = null;
    }
  }

  // --------------------------------------------------------------- tooltip
  function tipEl(player) {
    let tip = player.querySelector('.scrubber-tip');
    if (tip) return tip;
    tip = document.createElement('div');
    tip.className = 'scrubber-tip';
    // The panel takes the pointer once a comment is clipped, so these must not
    // reach the player underneath — it would seek or pause.
    const swallow = (e) => e.stopPropagation();
    tip.addEventListener('mousedown', swallow);
    tip.addEventListener('pointerdown', swallow);
    tip.addEventListener('dblclick', swallow);
    tip.addEventListener('click', (e) => { e.stopPropagation(); onTipClick(e); });
    tip.addEventListener('mouseenter', () => { if (S) S.tipHover = true; });
    tip.addEventListener('mouseleave', () => {
      if (!S) return;
      S.tipHover = false;
      if (!S.tipOpen && !S.tipAll) hideTip();
    });
    player.appendChild(tip);
    return tip;
  }

  // The panel is a fixed size borrowed from the preview, so leftover vertical
  // space is wasted unless it is handed back to the text. Everyone gets one
  // line, then spare lines go round-robin to whoever is still cut off.
  // Fits as many comments into the panel as it can hold, and says how many that
  // was. Returns the number kept, which is also what the footer's count is
  // measured against — a row that was rendered but cannot be seen is not shown.
  function fitRows(rowsEl, list) {
    let entries = list;
    if (!entries.length) return 0;
    const lh = parseFloat(getComputedStyle(entries[0].c).lineHeight) || 17;
    // Each row spends a band on the name and the time before a word of the
    // comment is drawn, and the fitting has to pay for it or the last row is
    // rendered where it cannot be seen.
    const head = (entries[0].head && entries[0].head.clientHeight) || HEAD_H;

    const want = entries.map((e) => {
      e.c.style.setProperty('-webkit-line-clamp', '99');
      return Math.max(1, Math.round(e.c.scrollHeight / lh));
    });

    // If the panel can't be measured, fall back to the stylesheet's two lines
    // rather than giving up: giving up left every row unclamped and, worse,
    // unflagged, so a truncated comment was not clickable.
    const avail = rowsEl.clientHeight;

    // Every row needs a line of its own. The ones there is no line for were
    // being rendered into the overflow, where they were invisible but still
    // counted — so the panel claimed four comments and showed three.
    if (avail) {
      let keep = entries.length;
      while (keep > 1 && keep * (lh + head) + (keep - 1) * ROW_GAP > avail) keep--;
      if (keep < entries.length) {
        for (const e of entries.slice(keep)) e.row.remove();
        entries = entries.slice(0, keep);
        want.length = keep;
      }
    }

    const gaps = (entries.length - 1) * ROW_GAP + entries.length * head;
    const lines = avail ? Math.floor((avail - gaps) / lh) : entries.length * 2;
    let budget = Math.max(entries.length, lines) - entries.length;
    const give = entries.map(() => 1);
    let moved = true;
    while (budget > 0 && moved) {
      moved = false;
      for (let i = 0; i < entries.length && budget > 0; i++) {
        if (give[i] < want[i]) { give[i]++; budget--; moved = true; }
      }
    }

    entries.forEach((e, i) => {
      e.c.style.setProperty('-webkit-line-clamp', String(give[i]));
      if (give[i] < want[i]) e.row.classList.add('is-clipped');
    });

    // Arithmetic gets it nearly right; the last row was still coming out sliced
    // in half at the bottom edge. Measure what was actually drawn and drop
    // whatever hangs over — a half-drawn comment is worse than one fewer.
    const box = rowsEl.getBoundingClientRect();
    if (box.height) {
      for (let i = entries.length - 1; i > 0; i--) {
        const r = entries[i].row.getBoundingClientRect();
        if (r.height && r.bottom > box.bottom + 1) {
          entries[i].row.remove();
          entries.splice(i, 1);
        }
      }
    }
    return entries.length;
  }

  function renderTipList(tip, near, all) {
    // Scrubbing changes this list constantly. Swapping the text in place made it
    // flicker, so the outgoing rows are left behind for a moment, fading out
    // over the incoming ones. 110ms: slow enough to read as a dissolve, fast
    // enough that dragging through a video never looks like it is lagging.
    let leaving = null;
    for (const n of tip.querySelectorAll(':scope > .st-rows')) {
      if (!n.classList.contains('is-out')) leaving = n;
    }
    for (const n of Array.prototype.slice.call(tip.children)) {
      if (n !== leaving) n.remove();
    }
    if (leaving) {
      leaving.classList.add('is-out');
      clearTimeout(leaving.__t);
      leaving.__t = setTimeout(() => leaving.remove(), 140);
    }
    tip.classList.remove('is-open');
    tip.classList.toggle('is-all', !!all);

    // Expanded to the whole window, the only way back was to click a comment and
    // hope. It gets the same way out the opened comment has.
    if (all) {
      const back = document.createElement('button');
      back.className = 'st-back';
      back.type = 'button';
      back.textContent = '\u2190 Back';
      tip.appendChild(back);
    }

    const rows = document.createElement('div');
    rows.className = 'st-rows';
    const entries = [];
    // The panel lists everything in the window, but only some of it pops out on
    // its own. Dim the rest's timestamp so the difference is visible rather than
    // something you have to discover by waiting for a card that never comes.
    const queued = new Set(schedule());
    // Two bands per comment: who and when across the top, what they said
    // underneath. Side by side, every comment started at a different place
    // because every name is a different length, and none of them lined up.
    (all ? near : near.slice(0, TIP_ROWS)).forEach((m, i) => {
      const row = document.createElement('div');
      row.className = 'st-row';
      if (queued.has(m)) row.classList.add('is-queued');
      row.dataset.i = String(i);

      const head = document.createElement('div');
      head.className = 'st-head';
      // A top comment has no timecode; the slot it was given is ours, not the
      // commenter's, so printing it as a timestamp would be a small lie. It says
      // what it is instead, exactly as the card does.
      const a = document.createElement('span');
      a.className = m.top ? 'st-t is-top' : 'st-t';
      a.textContent = m.top ? 'TOP' : fmtTime(m.t);
      const who = nameEl('st-who', m.author, m.who);
      const gap = document.createElement('span');
      gap.className = 'sp-gap';
      head.append(a, who, gap, replyChip(m), likeChip(m.likes, m));

      const c = document.createElement('div');
      c.className = 'st-c';
      c.textContent = trimLeadStamp(m.text, m.t);
      row.append(head, c);
      if (all) c.style.setProperty('-webkit-line-clamp', '3');
      rows.appendChild(row);
      entries.push({ row, c, head });
    });
    rows.classList.add('is-in');
    tip.appendChild(rows);

    // What stretch this is, and how much is in it — under the comments rather
    // than floating over the bar, where it collided with YouTube's own labels.
    const foot = document.createElement('div');
    foot.className = 'st-foot';
    const range = document.createElement('span');
    range.className = 'st-range';
    const w = S.tipWin;
    range.textContent = w ? fmtTime(w.lo) + ' \u2013 ' + fmtTime(w.hi) : '';
    foot.appendChild(range);
    tip.appendChild(foot);

    // Fit first, then count: the number has to be measured against the rows the
    // panel can actually show, not against the ones we hoped to fit.
    const shown = all ? entries.length : fitRows(rows, entries);
    // A count is only worth the space when it is telling you about something
    // you cannot already see.
    if (near.length > shown) {
      const total = document.createElement('span');
      total.className = 'st-total';
      total.textContent = 'View more (' + (near.length - shown) + ')';
      foot.appendChild(total);
      if (!all) foot.classList.add('is-more');
    }
  }

  // The panel borrows the preview's height, which is generous for three short
  // comments — and a box that is half empty under its own content looks like
  // something failed to load. Give the slack back, keeping the bottom edge
  // level with the preview's, which is the edge the two share.
  function trimTip(tip, rows) {
    if (!S || !S.tipBox || !rows) return;
    const box = rows.getBoundingClientRect();
    const have = box.height;
    if (!have) return;
    // Not scrollHeight: that is defined as at least the element's own box, so a
    // container with room to spare reports no spare room at all — which is why
    // this measured nothing to reclaim and the gap stayed. The content's real
    // height is where its last child ends.
    const kids = rows.children;
    const last = kids && kids.length ? kids[kids.length - 1] : null;
    const want = last ? (last.getBoundingClientRect().bottom - box.top + ROW_PAD) : 0;
    const slack = have - want;
    if (slack <= 6) return;
    const h = Math.max(TIP_MIN_H, S.tipBox.height - slack);
    if (h >= S.tipBox.height) return;
    const bottom = S.tipBox.top + S.tipBox.height;
    const top = Math.max(8, bottom - h);
    tip.style.height = Math.round(h) + 'px';
    tip.style.top = Math.round(top) + 'px';
    S.tipBox = { top: Math.round(top), height: Math.round(h), player: S.tipBox.player };
  }

  // Opening grows the panel upward from the bottom edge it already has, by at
  // most 30% of the player height, and then scrolls inside rather than growing
  // further. Replies expand in place under the same rule — the box is already
  // at its limit, so they push into the scroll.
  // Replies arrive in pages, and re-measuring on each one made the panel jump
  // about while it filled: a loading note, then eight replies, then eight more,
  // each a different height. It only ever grows while the same comment is open,
  // so the thing you are reading stays where you started reading it.
  function placeTipOpen(tip) {
    const base = S && S.tipBox;
    if (!base) return;
    const pane = tip.querySelector('.st-open');
    const at = pane ? pane.scrollTop : 0;
    tip.style.height = 'auto';
    const natural = tip.getBoundingClientRect().height;
    const maxH = base.height + base.player * 0.55;
    let h = Math.round(clamp(natural, base.height, maxH));
    h = Math.max(h, S.openH || 0);
    S.openH = h;
    tip.style.height = h + 'px';
    tip.style.top = Math.max(8, base.top + base.height - h) + 'px';
    if (pane && at) pane.scrollTop = at;
  }

  function renderTipOpen(tip, mark, replies) {
    tip.textContent = '';
    tip.classList.remove('is-all');
    tip.classList.add('is-open');

    const pane = document.createElement('div');
    pane.className = 'st-open';

    // The way out belongs at the top, where you start reading.
    const back = document.createElement('button');
    back.className = 'st-back';
    back.type = 'button';
    back.textContent = '\u2190 Back';
    pane.appendChild(back);

    const head = document.createElement('div');
    head.className = 'st-ohead';
    const t = document.createElement('span');
    t.className = mark.top ? 'st-t is-top' : 'st-t';
    t.textContent = mark.top ? 'TOP' : fmtTime(mark.t);
    const who = nameEl('st-oauthor', mark.author, mark.who);
    head.append(t, who, replyChip(mark), likeChip(mark.likes, mark));

    const body = document.createElement('div');
    body.className = 'st-otext';
    body.textContent = trimLeadStamp(mark.text, mark.t);
    pane.append(head, body);

    if (replies === null) {
      const l = document.createElement('div');
      l.className = 'st-rnote';
      l.textContent = 'loading replies…';
      pane.appendChild(l);
    } else if (replies && replies.length) {
      const wrap = document.createElement('div');
      wrap.className = 'st-replies';
      for (const r of replies) {
        const row = document.createElement('div');
        row.className = 'st-reply';
        const rh = document.createElement('div');
        rh.className = 'st-head';
        const a = nameEl('st-ra', r.author, r.authorPath);
        const rg = document.createElement('span');
        rg.className = 'sp-gap';
        // A reply is a comment like any other: it carries its own counts, and
        // its own way to answer it.
        const sub = { replyN: parseCount(r.replies), replyTo: r.replyParams || null,
          like: r.likeAction, likes: parseCount(r.likes), text: r.body, author: r.author };
        rh.append(a, rg, replyChip(sub), likeChip(sub.likes, sub));
        const c = document.createElement('div');
        c.className = 'st-rc';
        c.textContent = r.body || '';
        row.append(rh, c);
        wrap.appendChild(row);
      }
      pane.appendChild(wrap);

      // 26 replies do not arrive at once, on the page or here. The rest are one
      // click away rather than silently missing.
      const left = Math.max(0, (mark.replyN || 0) - replies.length);
      if (S && S.replyNext && left) {
        const more = document.createElement('button');
        more.className = 'st-more';
        more.type = 'button';
        more.textContent = 'View more (' + compactCount(left) + ')';
        pane.appendChild(more);
      }
    }

    tip.appendChild(pane);
  }

  // The composer lives at the bottom of the opened comment, under its replies.
  // The pen goes on YouTube's own time pill, because that pill is already the
  // label for the moment you are pointing at. It is our element sitting against
  // theirs rather than inside it: they rewrite that label's contents on every
  // frame of a scrub, and anything of ours in there would be swept away.
  function writeButton(player) {
    if (!player) return null;
    const can = typeof ScrubberFeed !== 'undefined' && ScrubberFeed.canCreate &&
      ScrubberFeed.canCreate();
    let btn = player.querySelector('.scrubber-write');
    const pill = can ? chromePill(player) : null;
    if (!pill || !previewBox(player)) {
      if (btn) btn.remove();
      return null;
    }
    if (!btn) {
      btn = document.createElement('button');
      btn.className = 'scrubber-write';
      btn.type = 'button';
      btn.title = 'Comment on this moment';
      btn.setAttribute('aria-label', 'Comment on this moment');
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('width', '14');
      svg.setAttribute('height', '14');
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('fill', 'currentColor');
      path.setAttribute('d', 'M20 4H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3v3.2L11.6 18H20a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm-7 9h-2v-2H9V9h2V7h2v2h2v2h-2v2z');
      svg.appendChild(path);
      btn.appendChild(svg);
      btn.addEventListener('mousedown', (e) => e.stopPropagation());
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const tip = tipEl(player);
        tip.classList.add('on');
        openWrite(tip);
      });
      player.appendChild(btn);
    }
    // Against the pill's right end, overlapping it a little, so the two read as
    // one control. On the left instead if that would leave the player.
    const pr = player.getBoundingClientRect();
    const r = pill.r;
    const size = 24;
    let left = r.right - pr.left + 6;             // just off its right end
    if (left + size > pr.width - 4) left = r.left - pr.left - size - 6;
    btn.style.left = Math.round(left) + 'px';
    btn.style.top = Math.round(r.top - pr.top + (r.height - size) / 2) + 'px';
    return btn;
  }

  // A comment of your own, about the moment under the cursor. The panel holds
  // still while it is open — it is not chasing the pointer any more, and it is
  // certainly not disappearing mid-sentence.
  function openWrite(tip) {
    if (tip.querySelector('.sp-compose')) return;
    const at = S.tipT || 0;
    // The panel may be showing the last stretch that had something in it, which
    // is not necessarily the stretch you are pointing at — and writing about
    // 0:54 under a comment from 1:08 is nonsense. Rebuild it for this moment
    // first, even if that leaves it empty.
    const player = dom.player();
    S.tipNear = nearAt(at);
    S.tipKey = null;
    if (player) placeTip(tip, player, null, S.tipNear.length);
    renderTipList(tip, S.tipNear, false);
    const fresh = tip.querySelector('.st-rows');
    if (fresh) trimTip(tip, fresh);
    S.tipWrite = true;
    const close = () => {
      S.tipWrite = false;
      const w = tip.querySelector('.sp-compose');
      if (w) w.remove();
      tip.classList.remove('is-writing');
      placeTipOpen(tip);
    };
    tip.classList.add('is-writing');
    openCompose({
      host: tip, mark: null, at, verb: 'Post',
      free: close, cancel: close,
    });
    placeTipOpen(tip);
  }

  // The reply box belongs to the opened comment, not to a mode you have to ask
  // for: if you can answer it, it is there.
  function composeInPane(tip) {
    const pane = tip.querySelector('.st-open');
    if (!pane || !S || !S.tipOpen || !S.tipOpen.replyTo) return;
    if (pane.querySelector('.sp-compose')) return;
    openCompose({ host: pane, mark: S.tipOpen, free: () => placeTipOpen(tip) });
    placeTipOpen(tip);
  }

  async function openTip(tip, mark) {
    S.replyList = [];
    S.replyNext = mark.replies || null;
    S.openH = 0;                                  // a fresh comment, a fresh size
    renderTipOpen(tip, mark, mark.replies ? null : []);
    composeInPane(tip);
    placeTipOpen(tip);
    if (!mark.replies) return;
    await moreReplies(tip, mark);
  }

  // One page of a thread, appended to whatever is already on screen.
  async function moreReplies(tip, mark) {
    if (typeof ScrubberFeed === 'undefined' || !S || !S.replyNext) return;
    const token = S.replyNext;
    S.replyNext = null;                           // one request in flight at a time
    const res = await ScrubberFeed.replies(token, REPLY_PAGE);
    if (!S || S.tipOpen !== mark) return;         // closed, or moved on, while waiting
    S.replyList = (S.replyList || []).concat(res.ok ? res.items : []);
    S.replyNext = res.ok ? (res.next || null) : null;
    renderTipOpen(tip, mark, S.replyList);
    composeInPane(tip);
    placeTipOpen(tip);
  }

  function onTipClick(ev) {
    if (!S) return;
    const player = dom.player();
    const tip = player && player.querySelector('.scrubber-tip');
    if (!tip) return;
    const hit = (sel) => ev.target && ev.target.closest && ev.target.closest(sel);

    if (hit('.sp-compose')) return;               // typing, not navigating

    const who = hit('.is-who');
    if (who && openAuthor(who)) return;

    if (hit('.st-write')) { openWrite(tip); return; }

    const chip = hit('.sp-likes');
    if (chip && likeTargets.has(chip)) { doLike(chip); return; }

    // Replying needs room to type and the comment in front of you, so it opens
    // the comment rather than trying to fit a box into a three-row list.
    const rc = hit('.sp-replies.can-reply');
    if (rc && replyTargets.has(rc)) {
      const mark = replyTargets.get(rc);
      if (S.tipOpen !== mark) { S.tipOpen = mark; openTip(tip, mark); }
      const box = tip.querySelector('.sp-compose .sp-input');
      if (box && box.focus) box.focus();
      return;
    }

    // Collapsing has to restore the size *before* the rows are fitted, or they
    // are measured against the opened panel's height, come out unclipped, and
    // stop being clickable — which is what made a comment open only once.
    const toList = (all) => {
      if (all) {
        renderTipList(tip, S.tipNear || [], true);
        placeTipOpen(tip);
      } else {
        // Sized for the comments it is about to hold, exactly as the hover does
        // — without the count it shrank to one row's worth and lost a comment
        // on the way back.
        placeTip(tip, player, null, (S.tipNear || []).length);
        renderTipList(tip, S.tipNear || [], false);
        const back = tip.querySelector('.st-rows');
        if (back) trimTip(tip, back);
      }
    };

    if (hit('.st-back') && !S.tipOpen) {
      S.tipAll = false; S.tipKey = null; toList(false); return;
    }

    if (S.tipOpen) {
      if (hit('.sp-compose')) return;              // typing, not navigating
      if (hit('.st-more')) { moreReplies(tip, S.tipOpen); return; }
      if (hit('.st-back')) { S.tipOpen = null; toList(S.tipAll); return; }
      const rep = hit('.st-reply');
      if (rep) { rep.classList.toggle('is-full'); placeTipOpen(tip); return; }
      S.tipOpen = null; S.tipAll = false; S.tipKey = null; toList(false);
      return;
    }

    // The footer's count is the affordance for the rest of the window.
    if (hit('.st-foot.is-more')) {
      S.tipAll = true;
      toList(true);
      // Every timestamped comment in this stretch, not only the ones that
      // happened to be popular enough to come back in the first few pages.
      deepenWindow(tip);
      return;
    }

    const row = hit('.st-row');
    if (row) {
      const mark = S.tipNear && S.tipNear[+row.dataset.i];
      if (mark) { S.tipOpen = mark; openTip(tip, mark); }
      return;
    }

    if (S.tipAll) { S.tipAll = false; S.tipKey = null; toList(false); }
  }

  // YouTube's red is a brand colour they have changed before, so it is sampled
  // off the player rather than hardcoded, and published as a custom property the
  // stylesheet reads. Falls back to their current red if the swatch moves.
  function syncAccent(player) {
    if (!player || S.accent) return;
    const sample = (el) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      const bg = cs.backgroundColor;
      if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') return bg;
      // The progress fill is a gradient, so its colour lives in the image rather
      // than in background-color, which reads as transparent.
      const m = (cs.backgroundImage || '').match(/rgba?\([^)]+\)/);
      return m ? m[0] : null;
    };
    const c = sample(player.querySelector('.ytp-scrubber-button')) ||
      sample(player.querySelector('.ytp-play-progress, .ytp-swatch-background-color'));
    if (!c) return;
    S.accent = c;
    player.style.setProperty('--scrubber-accent', c);
  }

  // YouTube labels the frame preview with a rounded pill — the chapter title and
  // the time. Our own chips say the same kind of thing, so they are painted with
  // the same material rather than an approximation of it, read off the live
  // element the first time a preview appears.
  // The pill itself: the small rounded label holding the time under the scrub
  // preview. Several things in the player wear that class, so take the one that
  // is actually pill-shaped and actually on screen.
  // The pill is the small rounded label holding the time under the scrub
  // preview. Class names were no help: several things in the player wear the
  // tooltip classes, including boxes pinned inside the storyboard frame, and
  // which one is the label changes with the layout. So it is found by what it
  // is — the smallest visible thing in the tooltip whose text is a timestamp —
  // and then we climb to whatever paints the rounded background around it.
  const TIME_TEXT = /^\d{1,2}:\d{2}(:\d{2})?\b/;

  function chromePill(player) {
    if (!player) return null;

    // Re-picking it on every mouse move is both wasteful and how it ended up
    // flickering between two elements, so once found it is remembered and only
    // its box is re-read. The search runs again when it goes away.
    if (S && S.pillEl && player.contains(S.pillEl)) {
      const r = S.pillEl.getBoundingClientRect();
      if (r.width && r.height) return { n: S.pillEl, r, cs: null };
      S.pillEl = null;
    }

    // Cheap pass first — text and boxes only, no style resolution — then the
    // expensive checks on the one candidate that won.
    let best = null;
    let bestArea = Infinity;
    const consider = (n) => {
      if (!n || !n.getBoundingClientRect) return;
      if (n.closest && (n.closest('.scrubber-tip') || n.closest('.scrubber-popouts'))) return;
      const t = (n.textContent || '').trim();
      if (!t || t.length > 80 || !TIME_TEXT.test(t)) return;
      const r = n.getBoundingClientRect();
      if (!r.width || !r.height || r.height > 70) return;
      const area = r.width * r.height;
      if (area < bestArea) { bestArea = area; best = { n, r, cs: null }; }
    };

    for (const root of player.querySelectorAll('.ytp-tooltip')) {
      consider(root);
      for (const n of root.querySelectorAll('*')) consider(n);
    }
    if (!best) return null;
    try {
      const cs = getComputedStyle(best.n);
      if (cs.visibility === 'hidden' || cs.display === 'none') return null;
      best.cs = cs;
    } catch (_) { return null; }

    // The text sits inside the pill; the pill is the first thing above it that
    // is actually painted.
    let n = best.n;
    for (let i = 0; i < 3 && n && n.parentElement; i++) {
      const up = n.parentElement;
      let cs;
      try { cs = getComputedStyle(up); } catch (_) { break; }
      const r = up.getBoundingClientRect();
      if (!r.height || r.height > 70) break;
      const bg = cs.backgroundColor || '';
      const painted = bg && bg !== 'transparent' && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(bg);
      if (painted) { best = { n: up, r, cs }; break; }
      n = up;
    }
    if (S) S.pillEl = best.n;
    return best;
  }

  function syncChrome(player) {
    if (!player || S.chrome) return;
    const opaque = (v) => {
      if (!v) return null;
      const m = v.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const parts = m[1].split(',').map((x) => parseFloat(x));
      if (parts.length > 3 && parts[3] < 0.08) return null;   // fully see-through
      return v;
    };
    const pill = chromePill(player);
    if (pill) {
      const n = pill.n;
      let cs = pill.cs;
      if (!cs) { try { cs = getComputedStyle(n); } catch (_) { return; } }
      const c = opaque(cs.backgroundColor);
      if (!c) return;
      const p4 = c.match(/rgba?\(([^)]+)\)/)[1].split(',').map((x) => parseFloat(x));
      // What the eye actually sees: the fill's own alpha, dimmed by whatever
      // opacity the element is carrying.
      const a0 = (p4.length > 3 ? p4[3] : 1) * (parseFloat(cs.opacity) || 1);
      // Measured off their pill over a white background, it sits a little under
      // half. A sample that comes back solid is a fill we are reading without
      // its element's own transparency, so it is brought into the same range
      // rather than taken at face value.
      const alpha = Math.min(0.48, Math.max(0.2, a0));
      const tint = 'rgba(' + Math.round(p4[0]) + ', ' + Math.round(p4[1]) + ', ' +
        Math.round(p4[2]) + ', ' + alpha + ')';
      S.chrome = tint;
      player.style.setProperty('--scrubber-chrome', tint);
      // Their pill is light in some themes and dark in others, and the label on
      // it has to stay readable either way.
      const lum = (0.2126 * p4[0] + 0.7152 * p4[1] + 0.0722 * p4[2]) / 255;
      const light = lum > 0.55;
      player.style.setProperty('--scrubber-chrome-fg',
        light ? 'rgba(16, 16, 18, .92)' : 'rgba(255, 255, 255, .94)');
      // A chip sitting on a panel of this same material has to separate from
      // it, so it goes one step further the way the material already leans.
      player.style.setProperty('--scrubber-chip',
        light ? 'rgba(0, 0, 0, .14)' : 'rgba(255, 255, 255, .17)');
      // Their corner, too. Copied rather than guessed, so the two shapes match
      // as well as the two colours do.
      const rad = parseFloat(cs.borderRadius);
      if (rad) player.style.setProperty('--scrubber-chrome-radius', rad + 'px');
    }
  }

  // The storyboard frame YouTube shows while scrubbing. Null when it isn't up —
  // which is also the signal that our own panel has outstayed its welcome.
  // Pulling up on the bar puts YouTube into fine scrubbing, where it takes over
  // the player with a much larger preview. Our panel has no business sizing
  // itself against that box, so it stands down and lets YouTube have the screen.
  function fineScrubbing(player) {
    if (!player) return false;
    if (player.classList && player.classList.contains('ytp-fine-scrubbing-mode')) return true;
    const pr = player.getBoundingClientRect();
    if (!pr.height) return false;
    for (const n of player.querySelectorAll('[class*="fine-scrubbing"]')) {
      const r = n.getBoundingClientRect();
      if (r.height > pr.height * 0.4 && r.width > pr.width * 0.5) return true;
    }
    return false;
  }

  function previewBox(player) {
    if (!player) return null;
    const pr = player.getBoundingClientRect();
    let box = null;
    let zTop = null;
    // Only the storyboard frame counts. The fine-scrubbing strip is nearly as
    // wide as the player, and sizing the panel to it threw it across the screen.
    for (const n of player.querySelectorAll('.ytp-tooltip')) {
      const r = n.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) continue;   // time-only tooltips, not the frame
      if (pr.height && r.height > pr.height * 0.5) continue;  // a takeover, not a frame
      if (pr.width && r.width > pr.width * 0.5) continue;     // a strip, not a frame
      // Ours is masked on release and YouTube's fades: either keeps its box, and
      // an invisible preview must not hold the cards up or count as present.
      const cs = getComputedStyle(n);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (parseFloat(cs.opacity || '1') < 0.05) continue;
      if (!box || r.width * r.height > box.w * box.h) {
        box = { x: r.left, y: r.top, w: r.width, h: r.height, el: n };
      }
      const z = parseInt(getComputedStyle(n).zIndex, 10);
      if (isFinite(z) && (zTop === null || z > zTop)) zTop = z;
    }
    if (box) box.z = zTop;
    return box;
  }

  // Sit beside YouTube's scrub preview and borrow its box — same top edge, same
  // height, same corner radius — so the two read as one unit instead of two
  // overlapping panels. Falls back to floating above the bar when no preview is
  // up (no storyboard, or a layout we don't recognise).
  function placeTip(tip, player, ev, count) {
    if (!player) return;
    syncChrome(player);           // the preview is up, so its label can be read
    const pr = player.getBoundingClientRect();
    const box = previewBox(player);
    if (box && box.z !== null && box.z !== undefined) tip.style.zIndex = String(box.z + 1);

    let w, h, top, left;
    if (box) {
      w = Math.max(box.w, 300);
      // Borrow the preview's height, but never at the cost of the comments: a
      // short preview would otherwise leave room for one row and a half. Grows
      // upward from the preview's bottom edge, so the two still end level.
      const rows = clamp(count || 1, 1, TIP_FIT);
      // Two lines apiece: one is a headline, not a comment.
      const wantH = TIP_CHROME + rows * (HEAD_H + 2 * 18) + (rows - 1) * ROW_GAP;
      h = Math.min(Math.max(box.h, wantH), Math.round(pr.height * 0.45));
      top = box.y - pr.top + box.h - h;
      // Right of the preview by preference; flipped to its left near the edge.
      left = box.x - pr.left + box.w + 8;
      if (left + w > pr.width - 8) left = box.x - pr.left - w - 8;
      // The corner comes from their label pill now, through the stylesheet, so
      // every surface of ours has the same one.
      tip.style.borderRadius = '';
    } else {
      w = 320;
      h = 132;
      top = pr.height - 78 - h;
      left = (ev ? ev.clientX - pr.left : pr.width / 2) - w / 2;
    }
    left = clamp(left, 8, Math.max(8, pr.width - w - 8));
    top = clamp(top, 8, Math.max(8, pr.height - h - 8));

    tip.style.width = Math.round(w) + 'px';
    tip.style.height = Math.round(h) + 'px';
    tip.style.left = Math.round(left) + 'px';
    tip.style.top = Math.round(top) + 'px';
    tip.style.bottom = 'auto';
    S.tipBox = { top: Math.round(top), height: Math.round(h), player: pr.height };
    writeButton(player);
  }

  function onBarMove(ev) {
    if (!S || !cfg.enabled || !cfg.showBars || !S.duration || dom.adShowing()) return;
    if (dom.name === 'mobile') return;          // no hover on touch
    if (S.tipOpen || S.tipAll || S.tipWrite) return;  // held open; don't chase the pointer
    const host = dom.progressHost();
    const player = dom.player();
    if (!host || !player) return;

    const rect = host.getBoundingClientRect();
    const t = clamp((ev.clientX - rect.left) / rect.width, 0, 1) * S.duration;
    const near = nearAt(t);

    unmaskPreview(player);
    const tip = tipEl(player);
    if (fineScrubbing(player)) { tip.classList.remove('on'); clearBarHints(); return; }
    paintBarHints(host, t);
    if (near.length === 0) { tip.classList.remove('on'); S.tipKey = null; return; }

    placeTip(tip, player, ev, near.length);
    // Switched on before the content is built: the panel is display:none until
    // then, and a hidden element measures zero, which left the line fitting with
    // nothing to divide up.
    tip.classList.add('on');
    // Rebuilding on every mousemove would re-run the line fitting each frame.
    const key = near.map((m) => m.t + ':' + m.likes).join('|') + '@' + tip.style.height + tip.style.width;
    if (key !== S.tipKey) {
      S.tipKey = key;
      S.tipNear = near;
      renderTipList(tip, near);
    }
    // placeTip sizes the panel from the preview on every move, so the slack has
    // to be given back on every move too — trimming only inside the render left
    // the gap to reappear on the next mouse movement that did not rebuild.
    const rowsEl = tip.querySelector('.st-rows');
    if (rowsEl) trimTip(tip, rowsEl);

    // The window travels with the cursor even when the comments inside it do
    // not, so the range is rewritten every move rather than only on a rebuild.
    const range = tip.querySelector('.st-range');
    if (range && S.tipWin) {
      range.textContent = fmtTime(S.tipWin.lo) + ' \u2013 ' + fmtTime(S.tipWin.hi);
    }
  }

  // YouTube ignores untrusted events entirely — a synthetic mousemove will not
  // keep the preview up and a synthetic leave will not take it down (both
  // verified against the live player). What does work is withholding the real
  // "pointer left" notification while the pointer is moving onto our panel or
  // onto the preview itself: YouTube simply never learns it left the bar.
  // YouTube's preview is pointer-events: none, so moving onto it never makes it
  // the event target — the hit test falls straight through to the video behind.
  // relatedTarget therefore never names it, and position is the only signal that
  // the pointer is still on something of ours.
  // Reaching the preview means crossing the gap above the bar, where the pointer
  // is on neither. Treat the whole corridor — preview, panel, and everything
  // down to the bar — as one surface, or the leave fires mid-journey.
  function overSurfaces(x, y) {
    const player = dom.player();
    if (!player) return false;
    const boxes = [];
    const tip = player.querySelector('.scrubber-tip');
    if (tip && tip.classList.contains('on')) boxes.push(tip.getBoundingClientRect());
    const pv = previewBox(player);
    if (pv) boxes.push({ left: pv.x, top: pv.y, right: pv.x + pv.w, bottom: pv.y + pv.h });
    const write = player.querySelector('.scrubber-write');
    if (write) boxes.push(write.getBoundingClientRect());
    if (!boxes.length) return false;

    let l = Infinity, r = -Infinity, t = Infinity, b = -Infinity;
    for (const bx of boxes) {
      l = Math.min(l, bx.left); r = Math.max(r, bx.right);
      t = Math.min(t, bx.top); b = Math.max(b, bx.bottom);
    }
    const host = dom.progressHost();
    if (host) b = Math.max(b, host.getBoundingClientRect().bottom);
    return inRect({ left: l, top: t, right: r, bottom: b }, x, y, 8);
  }

  function onLeaveCapture(e) {
    // Not gated on our own panel: the preview should survive being hovered
    // whether or not we have anything to say about that part of the video.
    if (!S || typeof e.clientX !== 'number') return;
    if (!overSurfaces(e.clientX, e.clientY)) return;
    S.previewHeld = true;
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  }

  // Having withheld that notification, YouTube's own state still believes the
  // pointer is on the bar and will not take the preview down until its controls
  // time out. So it is masked instead, and the mask is lifted on the next real
  // hover of the bar.
  function releasePreview() {
    if (!S || !S.previewHeld) return;
    S.previewHeld = false;
    const pv = previewBox(dom.player());
    if (pv && pv.el) pv.el.classList.add('scrubber-masked');
  }

  function unmaskPreview(player) {
    if (!player) return;
    const masked = player.querySelectorAll('.scrubber-masked');
    for (const n of masked) n.classList.remove('scrubber-masked');
  }

  function tipVisible() {
    const player = dom.player();
    const tip = player && player.querySelector('.scrubber-tip');
    return !!(tip && tip.classList.contains('on'));
  }

  function doHideTip() {
    const player = dom.player();
    const tip = player && player.querySelector('.scrubber-tip');
    if (tip) tip.classList.remove('on');
    clearBarHints();
    if (!S) return;
    // Gone means gone: the next hover starts at the list again, not wherever
    // this one was left.
    S.tipOpen = null;
    S.tipAll = false;
    S.openH = 0;
    S.tipKey = null;
    releasePreview();
    flushPending();
  }

  // Leaving the bar gets a short grace period, because reaching the panel means
  // crossing YouTube's preview, which is not the panel. But once that preview
  // is gone, scrubbing is over and the panel goes with it immediately.
  // The list goes almost at once; something you opened deliberately gets longer,
  // because you may be crossing the screen to read it. It used to get forever,
  // which meant an opened comment sat on the video until it was clicked away.
  function hideTip(immediate) {
    if (!S || S.tipWrite) return;                 // mid-sentence; nothing closes
    clearTimeout(S.tipHide);
    const opened = !!(S.tipOpen || S.tipAll);
    if (!opened && immediate) { doHideTip(); return; }
    S.tipHide = setTimeout(doHideTip, opened ? OPEN_GRACE : 220);
  }

  // --------------------------------------------------------------- pop-out
  // Which comment appears at a given moment has to be a function of the video
  // clock alone. It used to depend on frame timing (which marks happened to
  // fall between two `timeupdate` ticks) and on a wall-clock cooldown, so the
  // same second of video produced a different comment every time you passed it
  // — and a `fired` set burned every candidate it skipped. Instead: rank by
  // likes, space them by the cooldown measured in VIDEO seconds, and keep the
  // result. Rewinding to a point now always surfaces what it surfaced before.
  function buildSchedule() {
    const gap = Math.max(1, cfg.cooldown);
    const span = windowSpan();
    const eligible = inRange()
      .filter((m) => m.likes >= likeFloor() && m.n === 1)
      .sort((a, b) => a.t - b.t);

    // Comments about the same moment belong together — they stack rather than
    // competing for a single slot. The cooldown then spaces the bursts, not the
    // individual cards.
    const bursts = [];
    for (const m of eligible) {
      const last = bursts[bursts.length - 1];
      if (last && m.t - last[0].t <= span) last.push(m);
      else bursts.push([m]);
    }

    // Bursts compete for the cooldown on quality, not on who came first: taken
    // in time order, a lone one-like comment could claim the slot and silence a
    // cluster of well-liked ones 20 seconds later. Ties break on time, so the
    // outcome is still fixed for a given video.
    const ranked = bursts
      .map((b) => ({ b, top: Math.max(...b.map((m) => m.likes)), t: b[0].t }))
      .sort((x, y) => y.top - x.top || x.t - y.t);
    const taken = [];
    for (const r of ranked) {
      if (taken.every((q) => Math.abs(q.t - r.t) >= gap)) taken.push(r);
    }
    const out = [];
    for (const r of taken) {
      r.b.slice()
        .sort((a, b) => b.likes - a.likes)
        .slice(0, MAX_CARDS)
        .forEach((m) => out.push(m));
    }
    return out.concat(topComments(out)).sort((a, b) => a.t - b.t);
  }

  // The best comments that named no moment, spaced across the last few seconds
  // so they land while the video is finishing rather than interrupting it.
  // Comments that named no moment used to queue up at the end. Instead they fill
  // the stretches the timed ones leave empty — which on a video whose timestamps
  // all cluster in one place is most of it, and on a well-covered one is none.
  function topComments(timed) {
    if (!S || !S.duration || !S.top.length) return [];
    const dur = S.duration;
    const gap = Math.max(1, cfg.cooldown);
    const best = S.top.slice().sort((a, b) => b.likes - a.likes);

    const slots = [];
    for (let i = 0; i < TOP_SLOTS && slots.length < best.length; i++) {
      const t = dur * ((i + 0.5) / TOP_SLOTS);
      if (t < END_GAP || t > dur - 2) continue;
      if (timed.some((m) => Math.abs(m.t - t) < gap)) continue;
      if (slots.some((s) => Math.abs(s - t) < gap)) continue;
      slots.push(t);
    }

    return slots.map((t, i) => ({
      t,
      text: best[i].body,
      author: best[i].author,
      likes: best[i].likes,
      n: 0,
      replies: best[i].replyToken,
      like: best[i].like || null,
      replyTo: best[i].replyTo || null,
      replyN: best[i].replyN || 0,
      who: best[i].who || null,
      top: true,
    }));
  }

  function schedule() {
    if (!S) return [];
    if (!S.schedule) S.schedule = buildSchedule();
    return S.schedule;
  }

  // The switch belongs where people already look for the player's switches, so
  // it is built into YouTube's own settings menu, in their markup, taking their
  // styling. Their menu is rebuilt often, so this runs on the watch tick and
  // re-adds it whenever it has gone.
  function syncSettingsMenu() {
    const player = dom.player();
    if (!player) return;
    const menu = player.querySelector('.ytp-settings-menu .ytp-panel-menu') ||
      player.querySelector('.ytp-panel-menu');
    if (!menu) return;
    if (menu.querySelector('.scrubber-menuitem')) { paintSnooze(); return; }

    const item = document.createElement('div');
    item.className = 'ytp-menuitem scrubber-menuitem';
    item.setAttribute('role', 'menuitemcheckbox');
    item.setAttribute('aria-checked', S && S.snooze ? 'false' : 'true');
    item.setAttribute('tabindex', '0');

    const icon = document.createElement('div');
    icon.className = 'ytp-menuitem-icon';
    const label = document.createElement('div');
    label.className = 'ytp-menuitem-label';
    label.textContent = 'Comment pop-ups';
    const note = document.createElement('div');
    note.className = 'scrubber-menuitem-note';
    note.textContent = S && S.snooze ? snoozeLabel() : '';
    label.appendChild(note);
    const content = document.createElement('div');
    content.className = 'ytp-menuitem-content';
    const toggle = document.createElement('div');
    toggle.className = 'ytp-menuitem-toggle-checkbox';
    content.appendChild(toggle);
    item.append(icon, label, content);

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      setSnooze(S && S.snooze ? null : { video: true });
    });
    menu.appendChild(item);

    // Their panel is sized in JS when it opens, so an extra row would be cut
    // off. Give it the height back.
    const panel = menu.parentElement;
    const popup = player.querySelector('.ytp-settings-menu');
    const grow = (n) => {
      if (!n || !n.style || !n.style.height) return;
      const h = parseFloat(n.style.height);
      if (h) n.style.height = (h + 40) + 'px';
    };
    grow(panel);
    grow(popup);
  }

  // Quiet, on purpose. The marks and the scrub panel carry on — this is about
  // things appearing over the picture without being asked for.
  function snoozed() {
    if (!S || !S.snooze) return false;
    if (S.snooze.video) return true;
    if (S.snooze.until && Date.now() < S.snooze.until) return true;
    S.snooze = null;
    paintSnooze();
    return false;
  }

  function setSnooze(until) {
    if (!S) return;
    S.snooze = until;
    if (until) {
      for (const card of S.cards.slice()) dismissCard(card);
      S.pending = [];
      dropOverflow();
    }
    paintSnooze();
  }

  function snoozeLabel() {
    if (!S || !S.snooze) return '';
    if (S.snooze.video) return 'Snoozed for this video';
    const left = Math.max(0, Math.ceil((S.snooze.until - Date.now()) / 60000));
    return 'Snoozed for ' + left + ' more minute' + (left === 1 ? '' : 's');
  }

  // Both places that can show the state: the player's own settings menu and the
  // button on the stack.
  function paintSnooze() {
    const player = dom.player();
    if (!player) return;
    const on = !!(S && S.snooze);
    const item = player.querySelector('.scrubber-menuitem');
    if (item) {
      item.setAttribute('aria-checked', on ? 'false' : 'true');
      const label = item.querySelector('.scrubber-menuitem-note');
      if (label) label.textContent = on ? snoozeLabel() : '';
    }
  }

  function dropOverflow() {
    if (!S || !S.overflow.length) return;
    const player = dom.player();
    const stack = player && player.querySelector('.scrubber-popouts');
    // Not while it is open and being read.
    if (stack && stack.querySelector(':scope > .scrubber-overflow')) return;
    S.overflow = [];
    if (stack) renderOverflow(stack);
  }

  function dismissCard(card) {
    if (!S) return;
    clearTimeout(card.timer);
    card.el.classList.remove('on');
    const el = card.el;
    // It is still in the DOM while it fades, but it is no longer *showing* this
    // comment — leaving its key in place blocked the comment from returning.
    if (el.dataset) el.dataset.k = '';
    setTimeout(() => { if (el.parentNode) el.remove(); }, 300);
    S.cards = S.cards.filter((c) => c !== card);
    // Nothing on screen, nothing to count: the '+N' is about this burst.
    if (!S.cards.length) dropOverflow();
    const st = dom.player() && dom.player().querySelector('.scrubber-popouts');
    if (st) renderSnooze(st);
    const v = dom.video();
    if (v) paintBarFill(v.currentTime);
  }

  // Restarting a CSS animation needs a fresh node, so the countdown bar is
  // replaced rather than restyled.
  function armCard(card, secs) {
    clearTimeout(card.timer);
    const old = card.el.querySelector('.sp-timer i');
    if (old && old.parentNode) {
      const fresh = document.createElement('i');
      fresh.style.animationDuration = secs + 's';
      old.parentNode.replaceChild(fresh, old);
    }
    card.remain = secs * 1000;
    card.armedAt = Date.now();
    card.holds.clear();
    card.el.classList.remove('is-held');
    card.timer = setTimeout(() => dismissCard(card), card.remain);
    const v = dom.video();
    if (v && v.paused) holdCard(card, 'paused');
  }

  // A card can be frozen for more than one reason at once — you are reading it,
  // and the video is paused — so it only runs again when the last one lifts.
  function holdCard(card, why) {
    if (card.holds.has(why)) return;
    if (!card.holds.size) {
      clearTimeout(card.timer);
      card.remain = Math.max(0, card.remain - (Date.now() - card.armedAt));
    }
    card.holds.add(why);
    card.el.classList.add('is-held');
  }

  // The countdown bar is paused by the same class, so only the dismissal is
  // rescheduled — from where it stopped, not from the top.
  function resumeCard(card, why) {
    if (!card.holds.delete(why) || card.holds.size) return;
    card.el.classList.remove('is-held');
    card.armedAt = Date.now();
    card.timer = setTimeout(() => dismissCard(card), card.remain);
  }

  function holdAllCards(why) { if (S) S.cards.slice().forEach((c) => holdCard(c, why)); }
  function resumeAllCards(why) { if (S) S.cards.slice().forEach((c) => resumeCard(c, why)); }

  function popoutStack(player) {
    let stack = player.querySelector('.scrubber-popouts');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'scrubber-popouts';
      if (dom.name === 'mobile') stack.classList.add('is-mobile');
      player.appendChild(stack);
    }
    return stack;
  }

  // Only the last few seconds' worth is still about what is on screen; older
  // queued cards are dropped rather than dumped all at once.
  // The counter sits above the stack: how many are waiting, and the way in.
  // The stack sits bottom-left and the preview bottom-right, so on a wide player
  // they collide. When they do, the cards step up above it rather than under it.
  // Everything the cards have to stay out of the way of: the scrub preview, and
  // YouTube's own 'pull up for precise seeking' hint, which appears just above
  // the bar exactly where the stack starts.
  function obstacles(player) {
    const out = [];
    const pv = previewBox(player);
    // YouTube draws "Pull up for precise seeking" immediately above the preview,
    // outside the box we measure and under a class we cannot rely on, so the
    // preview's own box is extended upward to cover whatever it puts there.
    if (pv) out.push({ x: pv.x, y: pv.y - HINT_H, w: pv.w, h: pv.h + HINT_H });
    const pr = player.getBoundingClientRect();
    for (const n of player.querySelectorAll('[class*="fine-scrubbing"]')) {
      const r = n.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.height > pr.height * 0.4) continue;      // that's the full strip, not the hint
      let vis = true;
      try {
        const cs = getComputedStyle(n);
        vis = cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity || '1') >= 0.05;
      } catch (_) { /* fall back to trusting the box */ }
      if (vis) out.push({ x: r.left, y: r.top, w: r.width, h: r.height });
    }
    return out;
  }

  function avoidPreview(player) {
    if (!player) return;
    const stack = player.querySelector('.scrubber-popouts');
    if (!stack) return;
    stack.style.bottom = '';
    const pr = player.getBoundingClientRect();
    sizeStack(stack, pr);
    const sr = stack.getBoundingClientRect();
    if (!sr.height) return;

    let lift = 0;
    for (const b of obstacles(player)) {
      const clear = sr.right <= b.x || sr.left >= b.x + b.w ||
        sr.bottom <= b.y || sr.top >= b.y + b.h;
      if (clear) continue;
      lift = Math.max(lift, Math.round(pr.bottom - b.y) + 10);
    }
    if (lift) {
      const ceiling = Math.max(0, Math.round(pr.height - sr.height - 12));
      stack.style.bottom = Math.min(lift, ceiling) + 'px';
    }
    sizeStack(stack, pr);
  }

  // However tall the stack wants to be, it stops at the top of the picture and
  // scrolls the rest — an opened card with a thread under it is taller than the
  // player on its own.
  function sizeStack(stack, pr) {
    if (!stack || !pr || !pr.height) return;
    let bottom = 0;
    try { bottom = parseFloat(getComputedStyle(stack).bottom) || 0; } catch (_) { bottom = 0; }
    const room = Math.round(pr.height - bottom - 12);
    stack.style.maxHeight = Math.max(120, room) + 'px';
  }

  // One button for the whole stack rather than one per card: what you want is
  // quiet, not this particular comment gone.
  function renderSnooze(stack) {
    let btn = stack.querySelector(':scope > .scrubber-snooze');
    // An open menu keeps its button, however long the reading takes.
    const want = !!(S && (S.cards.length || stack.querySelector(':scope > .sc-menu')));
    if (!want) {
      if (btn) btn.remove();
      const m = stack.querySelector(':scope > .sc-menu');
      if (m) m.remove();
      return;
    }
    if (btn) return;
    btn = document.createElement('button');
    btn.className = 'scrubber-snooze';
    btn.type = 'button';
    btn.title = 'Stop comments popping up';
    btn.setAttribute('aria-label', 'Snooze comments');
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    // Its own size, in the markup: with the stylesheet missing an SVG with only
    // a viewBox draws at the intrinsic default, which is 300x150 of speech
    // bubble across the video.
    svg.setAttribute('width', '13');
    svg.setAttribute('height', '13');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('fill', 'currentColor');
    // A bell with a line through it.
    path.setAttribute('d', 'M18 16v-5c0-2.8-1.6-5.2-4.2-5.8V4.5a1.8 1.8 0 0 0-3.6 0v.7C7.6 5.8 6 8.2 6 11v5l-2 2v1h16v-1l-2-2zM12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zM3.3 2.9 21.1 20.7l-1.4 1.4L1.9 4.3z');
    svg.appendChild(path);
    btn.appendChild(svg);
    btn.addEventListener('mousedown', (e) => e.stopPropagation());
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggleSnoozeMenu(stack); });
    stack.insertBefore(btn, stack.firstChild);
  }

  function closeSnoozeMenu() {
    const player = dom.player();
    const menu = player && player.querySelector('.sc-menu');
    if (!menu) return false;
    menu.remove();
    // Whatever was on screen gets its time back, starting now.
    resumeAllCards('menu');
    const stack = player.querySelector('.scrubber-popouts');
    if (stack) renderSnooze(stack);
    return true;
  }

  function toggleSnoozeMenu(stack) {
    if (closeSnoozeMenu()) return;
    const menu = document.createElement('div');
    menu.className = 'sc-menu';
    menu.addEventListener('mousedown', (e) => e.stopPropagation());
    const add = (text, fn) => {
      const b = document.createElement('button');
      b.className = 'sc-mi';
      b.type = 'button';
      b.textContent = text;
      b.addEventListener('click', (e) => { e.stopPropagation(); closeSnoozeMenu(); fn(); });
      menu.appendChild(b);
    };
    if (S && S.snooze) {
      const note = document.createElement('div');
      note.className = 'sc-mnote';
      note.textContent = snoozeLabel();
      menu.appendChild(note);
      add('Start them again', () => setSnooze(null));
    } else {
      add('For 5 minutes', () => setSnooze({ until: Date.now() + 5 * 60000 }));
      add('Until the end of the video', () => setSnooze({ video: true }));
    }
    stack.insertBefore(menu, stack.firstChild);
    // Nothing expires out from under an open menu: choosing takes as long as it
    // takes, and the cards are exactly what the choice is about.
    holdAllCards('menu');
  }

  function renderOverflow(stack) {
    if (!S) return;
    let chip = stack.querySelector(':scope > .scrubber-more');
    // Three on screen plus one behind is four comments, and four is a number you
    // can just look at. The counter is for when there is more than that.
    if (S.overflow.length + Math.min(S.cards.length, MAX_CARDS) <= COUNT_MIN) {
      if (chip) chip.remove();
      const open = stack.querySelector(':scope > .scrubber-overflow');
      if (open) open.remove();
      return;
    }
    if (!chip) {
      chip = document.createElement('button');
      chip.className = 'scrubber-more';
      chip.type = 'button';
      chip.addEventListener('mousedown', (e) => e.stopPropagation());
      chip.addEventListener('click', (e) => { e.stopPropagation(); toggleOverflow(stack); });
      stack.insertBefore(chip, stack.firstChild);
    } else if (stack.firstChild !== chip) {
      stack.insertBefore(chip, stack.firstChild);
    }
    chip.textContent = '+' + S.overflow.length;
  }

  // The only scrolling surface in the whole extension, because this one really
  // is a list rather than a thing that should size itself to what it holds.
  function toggleOverflow(stack) {
    const open = stack.querySelector(':scope > .scrubber-overflow');
    if (open) { open.remove(); return; }

    const list = document.createElement('div');
    list.className = 'scrubber-overflow';
    list.addEventListener('mousedown', (e) => e.stopPropagation());
    list.addEventListener('click', (e) => {
      e.stopPropagation();
      const named = e.target && e.target.closest && e.target.closest('.is-who');
      if (named && openAuthor(named)) return;
      const chip = e.target && e.target.closest && e.target.closest('.sp-likes');
      if (chip && likeTargets.has(chip)) doLike(chip);
    });
    for (const m of S.overflow.slice(-OVERFLOW_ROWS).reverse()) {
      const row = document.createElement('div');
      row.className = 'so-row';
      const t = document.createElement('span');
      t.className = m.top ? 'so-t is-top' : 'so-t';
      // A list of many needs the time; a single card in the moment does not.
      t.textContent = m.top ? 'TOP' : fmtTime(m.t);
      const c = document.createElement('span');
      c.className = 'so-c';
      c.textContent = trimLeadStamp(m.text, m.t);
      row.append(t, c, replyChip(m), likeChip(m.likes, m));
      list.appendChild(row);
    }
    const chip = stack.querySelector(':scope > .scrubber-more');
    stack.insertBefore(list, chip ? chip.nextSibling : stack.firstChild);
  }

  function flushPending() {
    if (!S || !S.pending.length) return;
    const v = dom.video();
    const now = v ? v.currentTime : 0;
    const due = S.pending.filter((m) => {
      const at = showTime(m);
      return now >= at && now - at <= PENDING_GRACE;
    });
    S.pending = [];
    due.forEach(showPopout);
  }

  function showPopout(mark) {
    const player = dom.player();
    if (!player || !S || snoozed()) return;

    // Already up — give it its time back instead of stacking a duplicate.
    const stack = popoutStack(player);
    const key = (mark.author || '') + '\u0000' + mark.text;
    const live = S.cards.find((c) => c.mark === mark || c.key === key);
    if (live) { live.el.classList.add('on'); armCard(live, cfg.duration); return; }
    // Whatever put it there, the same comment never appears twice at once.
    for (const node of stack.children) {
      if (node.dataset && node.dataset.k === key) return;
    }

    const el = document.createElement('div');
    el.className = 'scrubber-popout';
    if (mark.top) el.classList.add('is-top');
    if (dom.name === 'mobile') el.classList.add('is-mobile');

    const meta = document.createElement('div');
    meta.className = 'sp-meta';
    // No timestamp: the card arrives at the moment it is about, so printing the
    // time again only repeats what you just watched. TOP keeps its badge because
    // that one is not about any moment at all.
    const who = nameEl('sp-who', mark.author, mark.who);
    const close = document.createElement('button');
    close.className = 'sp-close';
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close');
    if (mark.top) {
      const badge = document.createElement('span');
      badge.className = 'sp-t';
      badge.textContent = 'TOP';
      meta.appendChild(badge);
    }
    // A spacer rather than auto margins: the controls are optional, and an auto
    // margin on whichever happened to come first split the row in two when two
    // of them were present.
    const gap = document.createElement('span');
    gap.className = 'sp-gap';
    meta.append(who, gap, replyChip(mark), likeChip(mark.likes, mark), close);

    const body = document.createElement('div');
    body.className = 'sp-text';
    body.textContent = trimLeadStamp(mark.text, mark.t);

    const timer = document.createElement('div');
    timer.className = 'sp-timer';
    timer.appendChild(document.createElement('i'));

    el.append(meta, body, timer);
    stack.appendChild(el);

    el.dataset.k = key;
    const card = { el, mark, key, timer: null, remain: 0, armedAt: 0, holds: new Set() };
    S.cards.push(card);

    // Reading one shouldn't be a race against the timer.
    el.addEventListener('mouseenter', () => holdCard(card, 'hover'));
    el.addEventListener('mouseleave', () => resumeCard(card, 'hover'));
    el.addEventListener('mousedown', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const named = e.target && e.target.closest && e.target.closest('.is-who');
      if (named && openAuthor(named)) return;
      const chip = e.target && e.target.closest && e.target.closest('.sp-likes');
      if (chip && likeTargets.has(chip)) { doLike(chip); return; }
      if (e.target && e.target.closest && e.target.closest('.sp-compose')) return;
      if (e.target && e.target.closest && e.target.closest('.sp-thread')) return;
      // The count of replies is the way into them: opening the card shows the
      // thread and the reply box together.
      const rc = e.target && e.target.closest && e.target.closest('.sp-replies');
      if (rc && (mark.replies || mark.replyN || mark.replyTo)) {
        if (!el.classList.contains('is-full')) expandCard(card);
        const box = el.querySelector(':scope > .sp-compose .sp-input');
        if (box && box.focus) box.focus();
        return;
      }
      const openable = el.classList.contains('is-clipped') || el.classList.contains('can-open');
      if (openable && e.target && e.target.closest && e.target.closest('.sp-text')) {
        expandCard(card);
      }
    });
    close.addEventListener('click', (e) => { e.stopPropagation(); dismissCard(card); });

    renderOverflow(stack);
    renderSnooze(stack);
    requestAnimationFrame(() => {
      el.classList.add('on');
      // Newest at the bottom, so that is where the stack should be looking —
      // once the card is actually in the layout, not before it.
      if (stack.scrollHeight > stack.clientHeight) stack.scrollTop = stack.scrollHeight;
      avoidPreview(player);
      // Clamped to three lines; if that cut something off, say so and take taps.
      if (body.scrollHeight > body.clientHeight + 1) el.classList.add('is-clipped');
      // A short comment with a conversation under it is worth opening too — the
      // text is not the only thing in there.
      if (mark.replies || mark.replyN) el.classList.add('can-open');
    });
    armCard(card, cfg.duration);
    // Past three, the rest wait behind a counter rather than shoving the oldest
    // off screen before it has been read.
    while (S.cards.length > MAX_CARDS) {
      const oldest = S.cards[0];
      if (!S.overflow.some((m) => m === oldest.mark)) S.overflow.push(oldest.mark);
      dismissCard(oldest);
    }
    renderOverflow(stack);
  }

  function onTimeUpdate() {
    if (!S || !cfg.enabled || !cfg.showPopout || !S.duration || dom.adShowing()) return;
    const v = dom.video();
    if (!v || v.paused) return;

    const t = v.currentTime;
    const prev = S.lastT;
    S.lastT = t;

    // A seek is not playback — don't fire a burst of cards after scrubbing.
    if (prev === null || t < prev || t - prev > 2) {
      S.pending = [];
      dropOverflow();
      paintBarFill(t);
      return;
    }

    // Two comment surfaces at once is noise, so cards hold off while the scrub
    // panel is up. What they miss is queued rather than lost.
    for (const m of schedule()) {
      const at = showTime(m);
      if (at <= prev || at > t) continue;
      // The panel and the cards used to be mutually exclusive, which meant a
      // comment could be silently skipped for as long as you kept hovering the
      // bar. They coexist: the stack lifts itself clear of the preview.
      showPopout(m);
    }
    // After the cards, not before: on the tick a card appears, its mark has to
    // read as full rather than blinking empty for a frame.
    paintBarFill(t);
  }

  // ------------------------------------------------------ load more comments
  // YouTube only renders comments once they scroll into view, so walking to the
  // bottom is the only way to make them exist at all. Always returns the page
  // to where it started.
  async function scrollPass(rounds, stopped) {
    const home = window.scrollY;
    for (let i = 0; i < rounds; i++) {
      if (stopped && stopped()) return false;
      window.scrollTo(0, document.documentElement.scrollHeight);
      await sleep(650);
      scanComments();
    }
    if (stopped && stopped()) return false;
    window.scrollTo(0, home);
    await sleep(150);
    scanComments();
    return true;
  }

  // Ask YouTube for the comments instead of scrolling until it renders them:
  // the same call the page makes, same origin, same session, nothing moves on
  // screen. Never throws — an unavailable endpoint just reports not-ok.
  // A day-old copy of a video's comments is still a good copy: the marks are on
  // the bar before the first request comes back, and the refresh only has to
  // look for what is new.
  // The cached record is a fixed-shape tuple, so a build that adds a field to it
  // cannot read yesterday's copies — they come back missing whatever is new,
  // which is how a name could be a link in a freshly fetched reply and plain
  // text on the comment above it. Entries from an older shape are ignored and
  // refetched rather than half-used.
  async function cacheRead(id) {
    if (!id) return null;
    const all = await ScrubberApi.localGet(CACHE_KEY);
    const hit = all && all[id];
    if (!hit || !hit.c || hit.v !== CACHE_SHAPE) return null;
    if (Date.now() - (hit.at || 0) > CACHE_TTL) return null;
    return hit.c;
  }

  async function cacheWrite(id, records) {
    if (!id || !records || !records.length) return;
    const all = (await ScrubberApi.localGet(CACHE_KEY)) || {};
    const now = Date.now();
    for (const k of Object.keys(all)) {
      const e = all[k];
      if (!e || e.v !== CACHE_SHAPE || now - (e.at || 0) > CACHE_TTL) delete all[k];
    }
    all[id] = { v: CACHE_SHAPE, at: now, c: records.slice(-CACHE_PER_VIDEO) };
    // Newest videos first, then drop the tail: the store cannot grow forever.
    const keep = Object.keys(all)
      .sort((a, b) => (all[b].at || 0) - (all[a].at || 0))
      .slice(0, CACHE_VIDEOS);
    const trimmed = {};
    for (const k of keep) trimmed[k] = all[k];
    await ScrubberApi.localSet(CACHE_KEY, trimmed);
  }

  function ingestRecords(records) {
    let added = 0;
    for (const r of records) {
      added += ingest({
        body: r[0], author: r[1], likes: r[2],
        stamps: r[3], replyToken: r[4], likeAction: r[5], replyParams: r[6],
        replyCount: r[7], authorPath: r[8],
      });
    }
    return absorb(added);
  }

  async function fetchComments(pages) {
    if (typeof ScrubberFeed === 'undefined') return { ok: false, reason: 'feed missing' };
    const id = videoId();
    if (!id) return { ok: false, reason: 'no video id' };
    return ScrubberFeed.load(id, pages, (batch) => {
      if (!S) return;
      let added = 0;
      for (const c of batch) {
        added += ingest({
          body: c.body, author: c.author, likes: parseCount(c.likes),
          stamps: c.stamps, replyToken: c.replyToken, likeAction: c.likeAction,
          replyParams: c.replyParams, replyCount: parseCount(c.replies),
          authorPath: c.authorPath,
        });
      }
      absorb(added);
    });
  }

  // Opening the whole window is a request for everything in it, and what we
  // hold is only the video's most-liked few hundred comments — the timestamped
  // ones are scattered through the rest. So the list goes and gets them, keeps
  // rendering as they land, and says so while it is working.
  function ingestBatch(batch) {
    if (!S) return;
    let added = 0;
    for (const c of batch) {
      added += ingest({
        body: c.body, author: c.author, likes: parseCount(c.likes),
        stamps: c.stamps, replyToken: c.replyToken, likeAction: c.likeAction,
        replyParams: c.replyParams, replyCount: parseCount(c.replies),
        authorPath: c.authorPath,
      });
    }
    absorb(added);
    // Whatever is open is looking at the same set, so it grows too.
    const tip = dom.player() && dom.player().querySelector('.scrubber-tip');
    if (added && tip && S.tipAll && !S.tipOpen) repaintAll(tip);
  }

  // The first pages of a video are its most-liked comments, and a timestamped
  // comment is not usually a popular one — so what lands on the bar from them is
  // a sample, not the set. This keeps reading: the rest of that ordering, then
  // the other orderings the page offers, in chunks, until there is nothing left
  // or the budget runs out. Every comment it finds goes on the bar as it lands
  // and into the day's cache at the end.
  async function sweepComments() {
    if (!S || S.deepening || typeof ScrubberFeed === 'undefined') return;
    if (!ScrubberFeed.deepen || !ScrubberFeed.hasMore || !ScrubberFeed.hasMore()) return;
    const id = videoId();
    S.deepening = true;
    try {
      for (let round = 0; round < DEEP_ROUNDS; round++) {
        if (!S || videoId() !== id) return;        // they moved on; stop working
        const res = await ScrubberFeed.deepen(DEEP_PAGES, ingestBatch);
        if (!S || videoId() !== id) return;
        if (!res.ok || res.done) break;
        await sleep(DEEP_GAP);
      }
      if (S && videoId() === id) cacheWrite(id, S.raw);
    } finally {
      if (S) S.deepening = false;
      const tip = dom.player() && dom.player().querySelector('.scrubber-tip');
      if (tip) markDeepening(tip, false);
    }
  }

  async function deepenWindow(tip) {
    markDeepening(tip, true);
    await sweepComments();
    markDeepening(tip, false);
  }

  function markDeepening(tip, on) {
    const foot = tip && tip.querySelector('.st-foot');
    if (!foot) return;
    let note = foot.querySelector('.st-looking');
    if (!on) { if (note) note.remove(); return; }
    if (note) return;
    note = document.createElement('span');
    note.className = 'st-looking';
    note.textContent = 'looking for more\u2026';
    foot.appendChild(note);
  }

  // Re-render the opened window in place, keeping the reader where they were.
  function repaintAll(tip) {
    if (!S || !S.tipAll || !S.tipWin) return;
    const rows = tip.querySelector('.st-rows');
    const at = rows ? rows.scrollTop : 0;
    S.tipNear = nearAt(S.tipT || (S.tipWin.lo + S.tipWin.hi) / 2);
    renderTipList(tip, S.tipNear, true);
    placeTipOpen(tip);
    markDeepening(tip, !!S.deepening);
    const fresh = tip.querySelector('.st-rows');
    if (fresh) fresh.scrollTop = at;
  }

  async function loadMoreComments(rounds = 10) {
    const before = S ? S.marks.length : 0;
    const res = await fetchComments(10);
    if (res.ok) cacheWrite(videoId(), S ? S.raw : []);
    else await scrollPass(rounds);           // endpoint gone: fall back to scrolling
    return { added: (S ? S.marks.length : 0) - before, total: S ? S.marks.length : 0 };
  }

  // A video you have just opened has no comments rendered, so the bar is empty
  // until you go and fetch them yourself — the one bit of work this is supposed
  // to save. Do that walk once per video, early, while nobody is reading yet,
  // and put the page back. Any scroll, key or click means the viewer has taken
  // over: stop immediately and leave the page where they put it.
  async function autoLoadOnce() {
    if (!S || S.autoLoaded) return;
    S.autoLoaded = true;

    const id = videoId();
    const cached = await cacheRead(id);
    if (!S) return;
    const warm = !!(cached && cached.length);
    if (warm) ingestRecords(cached);

    // A cold video is worth a few pages; a warm one only needs to catch up.
    const res = await fetchComments(warm ? PAGES_REFRESH : PAGES_FIRST);
    if (!S) return;
    if (res.ok) {
      cacheWrite(id, S.raw);
      // Those pages are the video's most-liked comments, which is not where the
      // timestamped ones live. Keep reading in the background until the bar
      // holds all of them rather than a popular sample — once per video per day,
      // since the whole sweep goes into the cache.
      if (!warm) S.sweepTimer = setTimeout(sweepComments, SWEEP_DELAY);
      return;
    }
    if (warm) return;   // something is already on the bar: leave the page alone

    let taken = false;
    const handOver = () => { taken = true; };
    const EVENTS = ['wheel', 'touchstart', 'keydown', 'mousedown'];
    for (const e of EVENTS) window.addEventListener(e, handOver, { once: true, passive: true });
    try {
      await scrollPass(4, () => taken || !S);
    } finally {
      for (const e of EVENTS) window.removeEventListener(e, handOver);
    }
  }

  // ------------------------------------------------------------- lifecycle
  function teardown() {
    if (S) {
      S.cards.forEach((c) => clearTimeout(c.timer));
      clearTimeout(S.scanTimer);
      clearTimeout(S.autoTimer);
      clearTimeout(S.sweepTimer);
      clearTimeout(S.tipHide);
      clearInterval(S.durPoll);
      clearInterval(S.tipWatch);
      if (S.observer) S.observer.disconnect();
    }
    document
      .querySelectorAll('.scrubber-density, .scrubber-tip, .scrubber-popouts, .scrubber-tag, .scrubber-fallback-host')
      .forEach((n) => n.remove());
    S = null;
  }

  function setup() {
    teardown();
    dom = ScrubberDom.pick();
    if (!location.pathname.startsWith('/watch') || !videoId()) return;

    S = {
      vid: videoId(),
      duration: 0,
      marks: [],
      comments: 0,
      seen: new Set(),
      lastT: null,
      cards: [],
      schedule: null,
      scanTimer: null,
      observer: null,
      durPoll: null,
      autoTimer: null,
      autoLoaded: false,
      tipKey: null,
      tipNear: null,
      tipOpen: null,
      tipAll: false,
      tipWrite: false,
      openH: 0,
      deepening: false,
      sweepTimer: null,
      tipT: 0,
      replyList: null,
      replyNext: null,
      tipHover: false,
      tipWatch: null,
      pending: [],
      overflow: [],
      raw: [],
      top: [],
      keepPreview: false,
      pillEl: null,
      snooze: null,
      previewHeld: false,
      dragging: false,
      tipWin: null,
      tipHide: null,
      tipBox: null,
      winRange: null,
      accent: null,
      chrome: null,
      freshUntil: Date.now() + 2500,
    };

    // The real duration only appears once any pre-roll ad is done, and it can
    // change again on a mid-roll.
    S.durPoll = setInterval(() => {
      const d = contentDuration();
      if (d && d !== S.duration) {
        S.duration = d;
        renderDensity();
      }
    }, 500);

    const root = dom.commentRoot() || document.body;
    S.observer = new MutationObserver(() => {
      clearTimeout(S.scanTimer);
      S.scanTimer = setTimeout(scanComments, 350);
    });
    // The preview can vanish without any mouse movement — the controls auto-hide
    // — so its absence is polled rather than only checked on mousemove.
    let beat = 0;
    S.tipWatch = setInterval(() => {
      if (!S) return;
      // The panel is meant to read as part of YouTube's preview, so it has to
      // leave with it. At 150ms it visibly outlived it; the cheap check runs
      // every tick and the DOM work every other one.
      if (!(beat++ & 1)) {
        renderTag(dom.progressHost());
        avoidPreview(dom.player());
        sweepCards();
        ensureStyles(dom.player());
        syncSettingsMenu();
        // Their label pill exists before it is ever shown, and the cards want
        // its colour whether or not anyone has hovered the bar yet.
        syncChrome(dom.player());
        if (!S.tipWrite) writeButton(dom.player());
      }
      if (S.tipOpen || S.tipAll || S.tipWrite || S.tipHover || !tipVisible()) return;
      const pl = dom.player();
      if (fineScrubbing(pl) || !previewBox(pl)) hideTip(true);
    }, 70);

    S.observer.observe(root, { childList: true, subtree: true });
    scanComments();
    // Let YouTube finish laying the page out before moving it.
    S.autoTimer = setTimeout(autoLoadOnce, 1200);
  }

  // A card's countdown is a setTimeout, and a hidden tab throttles those — so
  // cards came back long after their time was up, and a video paused by the
  // browser held them open indefinitely. Nothing is worth showing to a tab
  // nobody is looking at: they go, and the video is left as it was found.
  document.addEventListener('visibilitychange', () => {
    if (!S || document.visibilityState !== 'hidden') return;
    for (const card of S.cards.slice()) dismissCard(card);
    dropOverflow();
  });

  // Belt and braces for the throttling itself: anything whose time has run out
  // is dismissed on the watch tick rather than waiting for its own timer.
  function sweepCards() {
    if (!S) return;
    for (const card of S.cards.slice()) {
      if (card.holds.size) continue;
      if (Date.now() - card.armedAt >= card.remain) dismissCard(card);
    }
  }

  // Bind once — these survive YouTube's client-side navigation.
  document.addEventListener('timeupdate', (e) => {
    if (e.target && e.target.tagName === 'VIDEO') onTimeUpdate();
  }, true);

  // Stopping the video stops everything on top of it.
  document.addEventListener('pause', (e) => {
    if (e.target && e.target.tagName === 'VIDEO') holdAllCards('paused');
  }, true);
  document.addEventListener('play', (e) => {
    if (e.target && e.target.tagName === 'VIDEO') resumeAllCards('paused');
  }, true);

  for (const t of ['mouseout', 'mouseleave', 'pointerout', 'pointerleave']) {
    document.addEventListener(t, onLeaveCapture, true);
  }

  document.addEventListener('mousemove', (e) => {
    const player = dom.player();
    const tip = player && player.querySelector('.scrubber-tip');
    const pv = previewBox(player);
    const write = player && player.querySelector('.scrubber-write');
    const onTip = !!(tip && (tip.contains(e.target) ||
      (tip.classList.contains('on') && inRect(tip.getBoundingClientRect(), e.clientX, e.clientY)))) ||
      !!(write && (write.contains(e.target) ||
        inRect(write.getBoundingClientRect(), e.clientX, e.clientY, 6)));
    const onPreview = !!(pv && inRect(
      { left: pv.x, top: pv.y, right: pv.x + pv.w, bottom: pv.y + pv.h }, e.clientX, e.clientY));
    if (S) S.keepPreview = onTip || onPreview;
    // The pill moves with the pointer, so the button on it has to move at the
    // same rate. On the watch tick it visibly trailed behind.
    if (S && !S.tipWrite) writeButton(player);

    if (onTip || onPreview) {
      if (S) clearTimeout(S.tipHide);
      unmaskPreview(player);
      return;
    }
    const host = dom.progressHost();
    // While the button is held the pointer is captured, so the target stops
    // being the bar — but the drag is still a scrub and the panel should track.
    if (host && (S && S.dragging || host.contains(e.target))) {
      if (S) clearTimeout(S.tipHide);
      onBarMove(e);
    } else {
      hideTip();
    }
  }, true);

  document.addEventListener('mousedown', (e) => {
    const host = dom.progressHost();
    if (S && host && host.contains(e.target)) S.dragging = true;
    // Anywhere that is not the menu or its own button closes it.
    const t = e.target;
    const inside = t && t.closest && (t.closest('.sc-menu') || t.closest('.scrubber-snooze'));
    if (!inside) closeSnoozeMenu();
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSnoozeMenu();
  }, true);
  document.addEventListener('mouseup', () => { if (S) S.dragging = false; }, true);

  window.addEventListener('yt-navigate-finish', () => setTimeout(setup, 250));
  window.addEventListener('state-navigateend', () => setTimeout(setup, 250)); // mobile
  window.addEventListener('resize', () => renderDensity());

  // Autoplaying into the next video used to leave the extension dead: the URL
  // changed once, setup ran once, and if the player or the id was not ready yet
  // that was the only attempt there would ever be — nothing else would fire
  // until the viewer navigated by hand. The check now compares what is set up
  // against what is on screen, so a missed start heals itself a beat later.
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      setTimeout(setup, 300);
      return;
    }
    const id = videoId();
    if (!location.pathname.startsWith('/watch') || !id) return;
    if (!S || S.vid !== id) setup();
  }, 800);

  ScrubberApi.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (!msg || !msg.type) return false;
    if (msg.type === 'scrubber:stats') {
      respond({
        onWatch: !!S,
        surface: dom.name,
        marks: S ? inRange().length : 0,
        comments: S ? S.comments : 0,
      });
      return true;
    }
    if (msg.type === 'scrubber:loadMore') {
      loadMoreComments().then(respond);
      return true;
    }
    if (msg.type === 'scrubber:config') {
      cfg = { ...cfg, ...msg.cfg };
      if (S) S.schedule = null;
      renderDensity();
      respond({ ok: true });
      return true;
    }
    return false;
  });

  ScrubberApi.onChanged((changes, areaName) => {
    if (areaName !== 'sync' && areaName !== 'local') return;
    for (const k of Object.keys(changes)) cfg[k] = changes[k].newValue;
    if (S) S.schedule = null;
    renderDensity();
  });

  ScrubberApi.get(DEFAULTS).then((stored) => {
    cfg = stored;
    setup();
  });
})();
