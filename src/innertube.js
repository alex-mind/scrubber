/* YouTube's own comment endpoint.
 *
 * Comments are rendered lazily: nothing exists in the DOM until the list is
 * scrolled into view, which is why this used to scroll the page for you. This
 * asks YouTube for them instead — the same POST /youtubei/v1/next the page
 * makes when you scroll, to the same origin, on the session already in the
 * browser. Nothing is sent anywhere else and nothing is stored.
 */
var ScrubberFeed = (() => {
  'use strict';

  const MOBILE = location.hostname.startsWith('m.');
  const ORIGIN = location.origin;

  // Walks every nested object. Responses are deep and the shapes move around,
  // so everything below searches by key rather than by a fixed path.
  function walk(node, fn, depth) {
    depth = depth || 0;
    if (!node || typeof node !== 'object' || depth > 40) return;
    fn(node);
    for (const k in node) {
      const v = node[k];
      if (v && typeof v === 'object') walk(v, fn, depth + 1);
    }
  }

  // ytcfg lives in the page's own JS world, which a content script cannot read.
  // The values are still sitting in the inline <script> text, though.
  function pageConfig() {
    let key = null;
    let ver = null;
    for (const s of document.querySelectorAll('script')) {
      const t = s.textContent;
      if (!t || t.indexOf('INNERTUBE') === -1) continue;
      if (!key) key = (t.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || [])[1] || null;
      if (!ver) ver = (t.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) || [])[1] || null;
      if (key && ver) break;
    }
    return { key, ver };
  }

  // Writes have to be signed the way the page signs them: a SHA-1 over the
  // timestamp, the SAPISID cookie and the origin. Reads need none of this.
  async function authHeader() {
    const m = document.cookie.match(/(?:^|;\s*)(?:SAPISID|__Secure-3PAPISID)=([^;]+)/);
    if (!m || !self.crypto || !self.crypto.subtle) return null;
    const ts = Math.floor(Date.now() / 1000);
    const buf = await self.crypto.subtle.digest(
      'SHA-1', new TextEncoder().encode(ts + ' ' + m[1] + ' ' + ORIGIN));
    const hex = Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0')).join('');
    return 'SAPISIDHASH ' + ts + '_' + hex;
  }

  // Every request is signed when a session exists, not just the write: the
  // server decides who is asking from the signature, not the cookie, and an
  // unsigned read comes back as the logged-out variant — which carries a
  // sign-in modal where the like action would be.
  async function post(body, cfg, path, auth) {
    if (auth === undefined) auth = await authHeader();
    const q = (cfg.key ? 'key=' + encodeURIComponent(cfg.key) + '&' : '') + 'prettyPrint=false';
    const res = await fetch(ORIGIN + '/youtubei/v1/' + (path || 'next') + '?' + q, {
      method: 'POST',
      credentials: 'same-origin',
      headers: Object.assign({
        'Content-Type': 'application/json',
        'X-YouTube-Client-Name': MOBILE ? '2' : '1',
        'X-YouTube-Client-Version': cfg.ver,
      }, auth ? { Authorization: auth, 'X-Origin': ORIGIN, 'X-Goog-AuthUser': '0' } : null),
      body: JSON.stringify({
        context: { client: { clientName: MOBILE ? 'MWEB' : 'WEB', clientVersion: cfg.ver } },
        ...body,
      }),
    });
    if (!res.ok) throw new Error('innertube ' + res.status);
    return res.json();
  }

  // The items appended by one continuation, in order. The trailing entry is the
  // token for the next page — taking the last avoids picking up the separate
  // continuations that belong to reply threads.
  function appended(json) {
    const out = [];
    for (const e of json.onResponseReceivedEndpoints || []) {
      const items =
        (e.appendContinuationItemsAction && e.appendContinuationItemsAction.continuationItems) ||
        (e.reloadContinuationItemsCommand && e.reloadContinuationItemsCommand.continuationItems);
      if (items) out.push(...items);
    }
    return out;
  }

  // A continuation arrives in one of two shapes and they are not interchangeable.
  // The comment list carries an endpoint that loads itself when it scrolls into
  // view; a reply thread carries a *button* — "Show more replies" — with the
  // token on its command instead. Reading only the first shape is why a comment
  // with 26 replies handed back ten and claimed that was all of them.
  function tokenOf(item) {
    const r = item && item.continuationItemRenderer;
    if (!r) return null;
    let found = null;
    walk(r, (o) => {
      const c = o.continuationCommand;
      if (!found && c && typeof c.token === 'string') found = c.token;
    });
    return found;
  }

  function nextToken(json) {
    const items = appended(json);
    for (let i = items.length - 1; i >= 0; i--) {
      const t = tokenOf(items[i]);
      if (t) return t;
    }
    return null;
  }

  // The comments section's own continuation, out of the watch response.
  function commentsToken(json) {
    let found = null;
    walk(json, (o) => {
      if (found || !o.itemSectionRenderer) return;
      const s = o.itemSectionRenderer;
      const id = String(s.sectionIdentifier || s.targetId || '');
      if (!/comment/i.test(id)) return;
      walk(s, (x) => {
        if (!found) found = tokenOf(x);
      });
    });
    return found;
  }

  // Two shapes are live at once: bodies as entities beside the renderers (the
  // current one) and the older self-contained commentRenderer. Read both — the
  // caller de-duplicates.
  // The like button carries an opaque action string. It lives on the thread's
  // toolbar rather than on the comment body, in both shapes.
  function likeAction(node) {
    let found = null;
    walk(node, (o) => {
      if (found) return;
      const lb = o.likeButtonViewModel || o.likeButton;
      if (!lb) return;
      walk(lb, (x) => {
        const e = x.performCommentActionEndpoint;
        if (!found && e && typeof e.action === 'string') found = e.action;
      });
    });
    return found;
  }

  // Replying needs its own opaque token, handed out per comment next to the
  // reply button. Signed out there is none, and the button is not offered.
  function replyParams(node) {
    let found = null;
    walk(node, (x) => {
      const e = x.createCommentReplyEndpoint;
      if (!found && e && typeof e.createReplyParams === 'string') found = e.createReplyParams;
      if (!found && typeof x.createReplyParams === 'string') found = x.createReplyParams;
    });
    return found;
  }

  // Where the name points. A handle is nicer than a channel id and YouTube
  // gives both, in a few different places depending on the shape.
  function authorPath(node) {
    let handle = null;
    let id = null;
    walk(node, (o) => {
      if (!handle && typeof o.canonicalBaseUrl === 'string' && o.canonicalBaseUrl) {
        handle = o.canonicalBaseUrl;
      }
      // The entity shape puts the readable one here instead.
      const w = o.webCommandMetadata;
      if (!handle && w && typeof w.url === 'string' && w.url.charAt(0) === '/') handle = w.url;
      if (!id && typeof o.browseId === 'string' && /^UC/.test(o.browseId)) id = o.browseId;
      if (!id && typeof o.channelId === 'string' && /^UC/.test(o.channelId)) id = o.channelId;
    });
    if (handle) return handle.charAt(0) === '/' ? handle : '/' + handle;
    return id ? '/channel/' + id : null;
  }

  function fromEntity(p, replyToken, like, reply) {
    const content = p.properties && p.properties.content;
    if (!content || typeof content.content !== 'string') return null;
    const stamps = [];
    for (const r of content.commandRuns || []) {
      const w = r && r.onTap && r.onTap.innertubeCommand && r.onTap.innertubeCommand.watchEndpoint;
      if (w && typeof w.startTimeSeconds === 'number') stamps.push(w.startTimeSeconds);
    }
    return {
      body: content.content,
      author: (p.author && p.author.displayName) || '',
      authorPath: authorPath(p.author),
      likes: (p.toolbar && (p.toolbar.likeCountNotliked || p.toolbar.likeCountLiked)) || '',
      replies: (p.toolbar && p.toolbar.replyCount) || '',
      stamps,
      replyToken: replyToken || null,
      likeAction: like || null,
      replyParams: reply || null,
    };
  }

  function fromRenderer(c, replyToken, like, reply) {
    if (!c.contentText) return null;
    const runs = c.contentText.runs ||
      (c.contentText.simpleText ? [{ text: c.contentText.simpleText }] : []);
    const stamps = [];
    for (const r of runs) {
      const w = r.navigationEndpoint && r.navigationEndpoint.watchEndpoint;
      if (w && typeof w.startTimeSeconds === 'number') stamps.push(w.startTimeSeconds);
    }
    return {
      body: runs.map((r) => r.text || '').join(''),
      author: (c.authorText && c.authorText.simpleText) || '',
      authorPath: authorPath(c.authorEndpoint) || authorPath(c.authorText),
      likes: (c.voteCount && c.voteCount.simpleText) || '',
      replies: (c.replyCount === undefined || c.replyCount === null) ? '' : String(c.replyCount),
      stamps,
      replyToken: replyToken || null,
      likeAction: like || likeAction(c) || null,
      replyParams: reply || replyParams(c) || null,
    };
  }

  // Signed in, the like command lives on the toolbar *surface* entity — keyed
  // from the view-model's toolbarSurfaceKey — not on any button in the thread.
  // Signed out, that same slot holds a sign-in modal and no action at all.
  function likeFromSurface(surface) {
    let found = null;
    walk(surface && surface.likeCommand, (x) => {
      const e = x.performCommentActionEndpoint;
      if (!found && e && typeof e.action === 'string') found = e.action;
    });
    return found;
  }

  // Posting a comment of your own needs its own token, handed out on the box
  // YouTube puts at the top of the comments — and only to a signed-in session.
  // Signed out there is a sign-in endpoint there instead, and no token at all.
  let createParams = null;
  // Where the last load stopped, and the other orderings the page offered. Both
  // are needed to go deeper later without starting from the beginning again.
  let resume = null;
  let otherSorts = [];
  let sortsSeen = false;

  function grabSorts(json) {
    if (sortsSeen) return;
    walk(json, (o) => {
      const m = o.sortFilterSubMenuRenderer;
      if (!m || !m.subMenuItems) return;
      sortsSeen = true;
      for (const it of m.subMenuItems) {
        if (it.selected) continue;              // the one we are already reading
        let tok = null;
        walk(it, (x) => {
          if (!tok && x.continuationCommand && typeof x.continuationCommand.token === 'string') {
            tok = x.continuationCommand.token;
          }
        });
        if (tok) otherSorts.push({ title: (it.title || 'other'), token: tok });
      }
    });
  }
  function grabCreateParams(json) {
    walk(json, (o) => {
      const e = o.createCommentEndpoint;
      if (e && typeof e.createCommentParams === 'string') createParams = e.createCommentParams;
      if (!createParams && typeof o.createCommentParams === 'string') createParams = o.createCommentParams;
    });
  }

  function extract(json) {
    const ents = new Map();
    const surfaces = new Map();
    walk(json, (o) => {
      const p = o.commentEntityPayload;
      if (p && p.key) ents.set(p.key, p);
      const t = o.engagementToolbarSurfaceEntityPayload;
      if (t && t.key) surfaces.set(t.key, t);
    });

    const out = [];
    const usedKeys = new Set();
    const usedRenderers = new Set();

    // A thread carries its replies' continuation next to the comment itself,
    // which is the only place to pick it up — walk threads first so the token
    // stays attached to the right comment.
    walk(json, (o) => {
      const th = o.commentThreadRenderer;
      if (!th) return;

      let token = null;
      walk(th.replies, (x) => { if (!token) token = tokenOf(x); });

      let key = null;
      let surfKey = null;
      walk(th.commentViewModel, (x) => {
        if (!key && typeof x.commentKey === 'string') key = x.commentKey;
        if (!surfKey && typeof x.toolbarSurfaceKey === 'string') surfKey = x.toolbarSurfaceKey;
      });
      const like = likeAction(th) || likeFromSurface(surfaces.get(surfKey));
      // Not out of th.replies: a token in there belongs to a reply, and sending
      // the wrong one would post under the wrong comment.
      const rep = replyParams({ ...th, replies: undefined }) ||
        replyParams(surfaces.get(surfKey));

      if (key && ents.has(key)) {
        const r = fromEntity(ents.get(key), token, like, rep);
        if (r) { out.push(r); usedKeys.add(key); }
        return;
      }
      const c = th.comment && th.comment.commentRenderer;
      if (c) {
        const r = fromRenderer(c, token, like, rep);
        if (r) { out.push(r); usedRenderers.add(c); }
      }
    });

    // Whatever no thread covered — a replies page, or a shape that has moved.
    walk(json, (o) => {
      const p = o.commentEntityPayload;
      if (!p || !p.key || usedKeys.has(p.key)) return;
      usedKeys.add(p.key);
      const r = fromEntity(p, null);
      if (r) out.push(r);
    });
    walk(json, (o) => {
      const c = o.commentRenderer;
      if (!c || usedRenderers.has(c)) return;
      usedRenderers.add(c);
      const r = fromRenderer(c, null);
      if (r) out.push(r);
    });

    return out;
  }

  return {
    /* Fetch up to `pages` pages of comments for a video, handing each batch to
     * onBatch as it lands so marks appear progressively. Resolves
     * { ok, comments } or { ok: false, reason } — never throws. */
    async load(videoId, pages, onBatch) {
      try {
        resume = null;
        otherSorts = [];
        sortsSeen = false;
        const cfg = pageConfig();
        if (!cfg.ver) return { ok: false, reason: 'no client version on page' };

        let token = commentsToken(await post({ videoId }, cfg));
        if (!token) return { ok: false, reason: 'no comments continuation' };

        let got = 0;
        for (let i = 0; i < pages && token; i++) {
          const json = await post({ continuation: token }, cfg);
          if (!createParams) grabCreateParams(json);
          grabSorts(json);
          const batch = extract(json);
          got += batch.length;
          if (batch.length) onBatch(batch);
          token = nextToken(json);
        }
        resume = token;                          // where to pick up, if asked
        return { ok: true, comments: got };
      } catch (e) {
        return { ok: false, reason: String((e && e.message) || e) };
      }
    },

    /* Replies to one comment, from the token its thread carried. */
    async replies(token, max) {
      try {
        const cfg = pageConfig();
        if (!cfg.ver) return { ok: false, reason: 'no client version on page' };
        const json = await post({ continuation: token }, cfg, 'next');
        // A long thread arrives a page at a time, exactly as it does on the
        // page itself, so hand the caller the way to ask for the next one.
        return { ok: true, items: extract(json).slice(0, max || 24), next: nextToken(json) };
      } catch (e) {
        return { ok: false, reason: String((e && e.message) || e) };
      }
    },

    /* Keep going: the rest of the ordering we were reading, and then the other
     * orderings the page offers. A video's timestamped comments are not all in
     * its most-liked few hundred, and this is the only way to the rest of them.
     * Resolves { ok, comments, done } — done meaning there is nothing left. */
    async deepen(pages, onBatch) {
      try {
        const cfg = pageConfig();
        if (!cfg.ver) return { ok: false, reason: 'no client version on page' };
        let got = 0;
        let budget = pages;

        while (budget > 0) {
          if (!resume) {
            const next = otherSorts.shift();
            if (!next) return { ok: true, comments: got, done: true };
            resume = next.token;
          }
          const json = await post({ continuation: resume }, cfg);
          grabSorts(json);
          const batch = extract(json);
          got += batch.length;
          if (batch.length) onBatch(batch);
          resume = nextToken(json);
          budget--;
        }
        return { ok: true, comments: got, done: !resume && !otherSorts.length };
      } catch (e) {
        return { ok: false, reason: String((e && e.message) || e) };
      }
    },

    /* Whether there is anything left to fetch for this video. */
    hasMore() { return !!(resume || otherSorts.length); },

    /* Whether this session can post a comment of its own on this video. */
    canCreate() { return !!createParams; },

    /* Post a new top-level comment as the signed-in user. Same rule as every
     * other write here: only ever from an explicit click on a send button. */
    async create(text) {
      try {
        const body = String(text || '').trim();
        if (!createParams || !body) return { ok: false, reason: 'nothing to send' };
        const cfg = pageConfig();
        if (!cfg.ver) return { ok: false, reason: 'no client version on page' };
        const auth = await authHeader();
        if (!auth) return { ok: false, reason: 'not signed in' };
        const json = await post(
          { createCommentParams: createParams, commentText: body },
          cfg, 'comment/create_comment', auth,
        );
        let posted = false;
        walk(json, (o) => {
          if (o.commentEntityPayload || o.commentRenderer) posted = true;
        });
        const err = json && json.actionResult && json.actionResult.status;
        if (err && err !== 'STATUS_SUCCEEDED') return { ok: false, reason: 'refused' };
        return posted ? { ok: true } : { ok: false, reason: 'refused' };
      } catch (e) {
        return { ok: false, reason: String((e && e.message) || e) };
      }
    },

    /* Post a reply to one comment as the signed-in user. Only ever called from
     * an explicit click on the card's own send button — never on a schedule,
     * never as a side effect of anything else. */
    async reply(params, text) {
      try {
        const body = String(text || '').trim();
        if (!params || !body) return { ok: false, reason: 'nothing to send' };
        const cfg = pageConfig();
        if (!cfg.ver) return { ok: false, reason: 'no client version on page' };
        const auth = await authHeader();
        if (!auth) return { ok: false, reason: 'not signed in' };
        const json = await post(
          { createReplyParams: params, commentText: body },
          cfg, 'comment/create_comment_reply', auth,
        );
        let posted = false;
        walk(json, (o) => {
          if (o.commentEntityPayload || o.commentRenderer) posted = true;
        });
        const err = json && json.actionResult && json.actionResult.status;
        if (err && err !== 'STATUS_SUCCEEDED') return { ok: false, reason: 'refused' };
        return posted ? { ok: true } : { ok: false, reason: 'refused' };
      } catch (e) {
        return { ok: false, reason: String((e && e.message) || e) };
      }
    },

    /* Like one comment as the signed-in user. Only ever called from a click. */
    async like(action) {
      try {
        const cfg = pageConfig();
        if (!cfg.ver) return { ok: false, reason: 'no client version on page' };
        const auth = await authHeader();
        if (!auth) return { ok: false, reason: 'not signed in' };
        const json = await post({ actions: [action] }, cfg, 'comment/perform_comment_action', auth);
        const results = json && json.actionResults;
        const failed = Array.isArray(results) && results.some((r) => r && r.status && r.status !== 'STATUS_SUCCEEDED');
        return failed ? { ok: false, reason: 'refused' } : { ok: true };
      } catch (e) {
        return { ok: false, reason: String((e && e.message) || e) };
      }
    },
  };
})();
