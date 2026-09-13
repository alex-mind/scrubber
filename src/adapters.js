/* DOM adapters.
 *
 * Desktop (www.youtube.com) and mobile (m.youtube.com) share zero markup, but
 * they do share how timestamps are encoded: an <a href="...&t=123s"> inside the
 * comment body. Everything platform-specific lives here; content.js stays generic.
 */
var ScrubberDom = (() => {
  'use strict';

  const isMobile = () =>
    location.hostname.startsWith('m.') || !!document.querySelector('ytm-app');

  const text = (n) => (n && (n.innerText || n.textContent) || '').trim();

  const desktop = {
    name: 'desktop',
    player: () => document.querySelector('#movie_player'),
    video: () => document.querySelector('#movie_player video') || document.querySelector('video'),
    adShowing: () => !!document.querySelector('#movie_player.ad-showing, #movie_player.ad-interrupting'),
    controlsHidden: () => !!document.querySelector('#movie_player.ytp-autohide'),
    progressHost: () => document.querySelector('#movie_player .ytp-progress-bar-container'),
    commentRoot: () => document.querySelector('ytd-comments#comments'),
    threads: () => document.querySelectorAll('ytd-comment-thread-renderer'),
    parts: (th) => ({
      body: th.querySelector('#content-text'),
      author: text(th.querySelector('#author-text')),
      likes: text(th.querySelector('#vote-count-middle')) || text(th.querySelector('#vote-count-left')),
    }),
  };

  // Mobile class names are obfuscated and rotate, so resolve the bar by probing
  // rather than trusting one selector. Shape beats name: a wide, short box near
  // the bottom of the player is the progress bar.
  const MOBILE_BAR_HINTS = [
    '.ytChapteredProgressBarHost',              // observed on m.youtube.com, Sep 2026
    '.ytp-progress-bar-container',
    '.ytp-progress-bar',
    'ytm-watch-player-controls [class*="rogress"]',
    '#movie_player [class*="ProgressBar"]',
    '#movie_player [class*="progress-bar"]',
  ];

  // The overlay is absolutely positioned against its host, so a `static` host
  // would silently anchor it to some far-away ancestor instead. Walk up to the
  // nearest positioned element still inside the player.
  function positionedHost(node, player) {
    let n = node;
    while (n && n !== player) {
      if (getComputedStyle(n).position !== 'static') return n;
      n = n.parentElement;
    }
    return player;   // the player itself is positioned
  }

  function probeProgressHost() {
    const player = document.querySelector('#movie_player');
    if (!player) return null;
    const pr = player.getBoundingClientRect();
    if (!pr.width) return null;

    for (const sel of MOBILE_BAR_HINTS) {
      for (const n of document.querySelectorAll(sel)) {
        const r = n.getBoundingClientRect();
        const wideEnough = r.width > pr.width * 0.5;
        const shortEnough = r.height > 0 && r.height < 48;
        const nearBottom = r.bottom > pr.top + pr.height * 0.55;
        if (wideEnough && shortEnough && nearBottom) return positionedHost(n, player);
      }
    }
    return null;
  }

  // Last resort: our own strip pinned to the bottom of the player, so the marks
  // still render on a layout we failed to recognise.
  function fallbackHost() {
    const player = document.querySelector('#movie_player');
    if (!player) return null;
    let strip = player.querySelector('.scrubber-fallback-host');
    if (!strip) {
      strip = document.createElement('div');
      strip.className = 'scrubber-fallback-host';
      player.appendChild(strip);
    }
    return strip;
  }

  const mobile = {
    name: 'mobile',
    player: () => document.querySelector('#movie_player'),
    video: () => document.querySelector('#movie_player video') || document.querySelector('video'),
    adShowing: () =>
      !!document.querySelector('.ytp-ad-player-overlay, .ytp-ad-persistent-progress-bar-container') ||
      !!document.querySelector('#movie_player.ad-showing'),
    controlsHidden: () => false,   // mobile controls are tap-toggled; keep marks visible
    progressHost: () => probeProgressHost() || fallbackHost(),
    commentRoot: () =>
      document.querySelector('ytm-engagement-panel-section-list-renderer') ||
      document.querySelector('ytm-app') ||
      document.body,
    threads: () => document.querySelectorAll('ytm-comment-thread-renderer'),
    parts: (th) => ({
      body: th.querySelector('p.YtmCommentRendererText') || th.querySelector('[class*="CommentRendererText"]'),
      author: text(th.querySelector('span.YtmCommentRendererTitle') || th.querySelector('[class*="CommentRendererTitle"]')),
      likes: text(
        th.querySelector('.YtmCommentRendererDetails .YtmCommentRendererCount') ||
        th.querySelector('[class*="CommentRendererCount"]')
      ),
    }),
  };

  return { pick: () => (isMobile() ? mobile : desktop), isMobile };
})();
