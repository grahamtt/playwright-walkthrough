/**
 * The overlay engine.
 *
 * This whole function is serialized and run *inside the page* (via
 * page.evaluate / addInitScript), so it must be fully self-contained:
 * no imports, no references to outer scope.
 *
 * Design goal of the spike: ONE engine, ONE animation model that serves both
 * outputs. A screenshot is just `animate(state, 0)` (snap to final state, then
 * capture). A video is `animate(state, N)` (tween over N ms while Playwright's
 * recorder captures frames). Node paces the video by awaiting evaluate() calls,
 * which resolve when the in-page tween promise resolves.
 *
 * Everything is positioned from getBoundingClientRect() in the page's own
 * coordinate system, with position:fixed + pointer-events:none, so it never
 * reflows the page and needs no device-scale-factor math.
 */
export function installOverlay() {
  if (window.__wt) return;

  const SVGNS = 'http://www.w3.org/2000/svg';
  const PAD = 8; // px of breathing room around the highlighted element

  // ---- styles ------------------------------------------------------------
  const style = document.createElement('style');
  style.id = '__wt_style';
  style.textContent = `
    #__wt_root, #__wt_root * { box-sizing: border-box; }
    #__wt_root {
      position: fixed; inset: 0; z-index: 2147483647;
      pointer-events: none;
      font: 15px/1.45 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      /* reset the Popover API user-agent styles so the root stays a
         transparent full-screen layer when promoted to the top layer */
      margin: 0; border: 0; padding: 0; width: 100%; height: 100%;
      background: transparent; overflow: visible;
    }
    #__wt_root:popover-open { display: block; }
    /* No CSS opacity transitions: opacity is driven by the rAF tween so the
       screenshot path (duration 0) and the video path (duration N) share one
       timing model and can never disagree. */
    #__wt_spot { position: fixed; inset: 0; width: 100%; height: 100%; opacity: 0; }
    #__wt_ring { position: fixed; left: 0; top: 0; width: 0; height: 0;
      border: 3px solid #4f8cff; border-radius: 8px;
      box-shadow: 0 0 0 2px rgba(255,255,255,.55), 0 0 22px rgba(79,140,255,.6);
      opacity: 0; }
    #__wt_caption { position: fixed; left: 0; top: 0; max-width: 440px;
      padding: 12px 16px; border-radius: 12px;
      background: rgba(18,20,27,.93); color: #fff;
      box-shadow: 0 10px 36px rgba(0,0,0,.4);
      opacity: 0; backdrop-filter: blur(2px); }
    #__wt_caption b { color: #9cc1ff; }
    #__wt_cursor { position: fixed; left: 0; top: 0; width: 26px; height: 26px;
      margin: -3px 0 0 -3px; filter: drop-shadow(0 2px 3px rgba(0,0,0,.45)); }
    #__wt_cursor .ring { position: absolute; left: 2px; top: 2px;
      width: 22px; height: 22px; border-radius: 50%;
      border: 2px solid #4f8cff; opacity: 0; }
    #__wt_cursor.click .ring { animation: __wt_ripple .45s ease-out; }
    @keyframes __wt_ripple {
      from { transform: scale(.35); opacity: .85; }
      to   { transform: scale(2.6); opacity: 0; }
    }
  `;
  document.documentElement.appendChild(style);

  // ---- DOM ---------------------------------------------------------------
  const root = document.createElement('div');
  root.id = '__wt_root';

  // Spotlight = full-screen dim with an SVG mask cutout around the target
  // (the driver.js technique: white = visible dim, black = hole).
  const spot = document.createElementNS(SVGNS, 'svg');
  spot.id = '__wt_spot';
  spot.innerHTML = `
    <defs>
      <mask id="__wt_mask">
        <rect x="0" y="0" width="100%" height="100%" fill="white"/>
        <rect id="__wt_hole" x="0" y="0" width="0" height="0" rx="10" fill="black"/>
      </mask>
    </defs>
    <rect x="0" y="0" width="100%" height="100%"
          fill="rgba(10,12,18,.55)" mask="url(#__wt_mask)"/>`;

  const ring = document.createElement('div');
  ring.id = '__wt_ring';

  const caption = document.createElement('div');
  caption.id = '__wt_caption';

  const cursor = document.createElement('div');
  cursor.id = '__wt_cursor';
  cursor.innerHTML = `
    <div class="ring"></div>
    <svg width="26" height="26" viewBox="0 0 26 26">
      <path d="M5 3 L5 21 L10 16 L13.5 23 L16 22 L12.5 15 L19 15 Z"
            fill="#fff" stroke="#1b2330" stroke-width="1.4" stroke-linejoin="round"/>
    </svg>`;

  root.append(spot, ring, caption, cursor);
  document.body.appendChild(root);

  // Promote the overlay into the browser's TOP LAYER via the Popover API, so it
  // can paint over modal <dialog>s / popovers / fullscreen content, which a
  // plain high z-index cannot beat. Degrades gracefully if unsupported.
  let asPopover = false;
  try {
    root.setAttribute('popover', 'manual');
    root.showPopover();
    asPopover = true;
  } catch { /* old browser: falls back to z-index stacking */ }

  // Re-assert top-layer position: a modal opened *after* us would otherwise
  // stack on top. Hiding + re-showing moves us back to the front of the layer.
  function raise() {
    if (!asPopover) return;
    try { root.hidePopover(); root.showPopover(); } catch { /* noop */ }
  }

  const hole = spot.querySelector('#__wt_hole');

  // ---- state + tweening --------------------------------------------------
  const state = {
    rect: null, // {x,y,w,h} in viewport coords, or null = nothing focused
    cursor: { x: window.innerWidth / 2, y: window.innerHeight * 0.82 },
    alpha: 0,   // 0..1 fade of the spotlight/ring/caption group
    captionText: '',
  };

  const lerp = (a, b, t) => a + (b - a) * t;
  const lerpRect = (a, b, t) => ({
    x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t),
    w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t),
  });
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  function render() {
    cursor.style.transform = `translate(${state.cursor.x}px, ${state.cursor.y}px)`;
    if (state.rect) {
      const r = state.rect;
      const x = r.x - PAD, y = r.y - PAD, w = r.w + 2 * PAD, h = r.h + 2 * PAD;
      ring.style.left = x + 'px'; ring.style.top = y + 'px';
      ring.style.width = w + 'px'; ring.style.height = h + 'px';
      hole.setAttribute('x', x); hole.setAttribute('y', y);
      hole.setAttribute('width', Math.max(0, w)); hole.setAttribute('height', Math.max(0, h));
      ring.style.opacity = String(state.alpha);
      spot.style.opacity = String(state.alpha);
    } else {
      ring.style.opacity = '0';
      spot.style.opacity = '0';
    }
    caption.style.opacity = state.captionText ? String(state.alpha) : '0';
  }

  // The single animation primitive. duration<=0 => snap (screenshot path).
  function animate(target, duration) {
    return new Promise((resolve) => {
      const fromRect = state.rect;
      const fromCursor = { ...state.cursor };
      const fromAlpha = state.alpha;
      const toRect = target.rect !== undefined ? target.rect : state.rect;
      const toCursor = target.cursor || state.cursor;
      const toAlpha = target.alpha !== undefined ? target.alpha : state.alpha;
      // If we had no rect before, don't "grow from zero" — start at the target.
      const startRect = fromRect || toRect;

      const settle = () => {
        state.rect = toRect; state.cursor = { ...toCursor }; state.alpha = toAlpha;
        render(); resolve();
      };
      if (!duration || duration <= 0) { settle(); return; }

      const t0 = performance.now();
      (function frame() {
        const raw = Math.min(1, (performance.now() - t0) / duration);
        const e = easeInOut(raw);
        if (toRect) state.rect = startRect ? lerpRect(startRect, toRect, e) : toRect;
        state.cursor = { x: lerp(fromCursor.x, toCursor.x, e), y: lerp(fromCursor.y, toCursor.y, e) };
        state.alpha = lerp(fromAlpha, toAlpha, e);
        render();
        if (raw < 1) requestAnimationFrame(frame);
        else settle();
      })();
    });
  }

  function placeCaption(text, rect) {
    state.captionText = text || '';
    caption.innerHTML = state.captionText;
    // Below the element if there's room, else above.
    const cw = Math.min(440, caption.scrollWidth || 440);
    let left = rect ? rect.x : window.innerWidth / 2 - cw / 2;
    left = Math.max(16, Math.min(left, window.innerWidth - cw - 16));
    caption.style.left = left + 'px';
    const below = rect ? rect.y + rect.h + PAD + 12 : window.innerHeight - 120;
    const ch = caption.offsetHeight || 64;
    const top = below + ch > window.innerHeight - 16 && rect
      ? rect.y - ch - PAD - 12
      : below;
    caption.style.top = Math.max(16, top) + 'px';
    // opacity is driven by render() via state.alpha
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- public API --------------------------------------------------------
  window.__wt = {
    /** Focus a rect: move cursor to it, spotlight + ring it, show caption. */
    focus(rect, opts = {}) {
      raise();
      placeCaption(opts.label, rect);
      const center = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
      return animate({ rect, cursor: center, alpha: 1 }, opts.duration || 0);
    },
    /** Same, but resolve the selector to a live rect inside the page. */
    focusSelector(selector, opts = {}) {
      const el = document.querySelector(selector);
      if (!el) throw new Error('__wt: no element for selector ' + selector);
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const b = el.getBoundingClientRect();
      return this.focus({ x: b.x, y: b.y, w: b.width, h: b.height }, opts);
    },
    /** Click ripple at the current cursor position. */
    click(duration = 420) {
      cursor.classList.remove('click');
      void cursor.offsetWidth; // restart the animation
      cursor.classList.add('click');
      return wait(duration);
    },
    /** Just show a caption (no target) — e.g. an intro/note card. */
    say(text, opts = {}) {
      raise();
      placeCaption(text, null);
      return animate({ rect: null, alpha: 1 }, opts.duration || 0);
    },
    /** Clear everything (fade out, then drop the target/caption). */
    async clear(opts = {}) {
      await animate({ alpha: 0 }, opts.duration || 0);
      state.rect = null; state.captionText = '';
      render();
    },
  };

  render();
}
