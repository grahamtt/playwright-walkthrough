/**
 * The in-page overlay engine (validated in `spike/`).
 *
 * This entire function is serialized and run *inside the page* (via
 * page.addInitScript / page.evaluate), so it must be fully self-contained — no
 * imports, no references to outer/module scope. TypeScript types are erased at
 * transpile time, so they're free to use here; they never reach the page.
 *
 * One animation model serves both outputs: `animate(state, 0)` snaps to the end
 * state (screenshot path); `animate(state, N)` tweens over N ms (video path).
 * Opacity is part of the tween — never a CSS transition — so the two paths can
 * never disagree (see REQUIREMENTS.md §9).
 */
export function installOverlay(): void {
  const w = window as unknown as { __wt?: unknown };
  if (w.__wt) return;

  // addInitScript runs at document-start, before <body> exists. Defer until the
  // DOM is ready, then build once.
  const boot = () => {
    if (w.__wt) return;

    // Isolate the overlay in a CLOSED shadow root. Playwright pierces *open*
    // shadow roots but not closed ones, so our caption text (which contains the
    // user's narration, e.g. "<b>Add Item</b>") stays invisible to the test's
    // own getByText/getByRole locators. Without this, the overlay collides with
    // the very selectors the walkthrough uses.
    const host = document.createElement('div');
    host.id = '__wt_host';
    document.body.appendChild(host);
    const sr = host.attachShadow({ mode: 'closed' });

    type Rect = { x: number; y: number; w: number; h: number };
    type Target = { rect?: Rect | null; cursor?: { x: number; y: number }; alpha?: number };

    const SVGNS = 'http://www.w3.org/2000/svg';
    const PAD = 8;

    const style = document.createElement('style');
    style.id = '__wt_style';
    style.textContent = `
      #__wt_root, #__wt_root * { box-sizing: border-box; }
      #__wt_root {
        position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;
        font: 15px/1.45 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        margin: 0; border: 0; padding: 0; width: 100%; height: 100%;
        background: transparent; overflow: visible;
      }
      #__wt_root:popover-open { display: block; }
      #__wt_spot { position: fixed; inset: 0; width: 100%; height: 100%; opacity: 0; }
      #__wt_ring { position: fixed; left: 0; top: 0; width: 0; height: 0;
        border: 3px solid #4f8cff; border-radius: 8px;
        box-shadow: 0 0 0 2px rgba(255,255,255,.55), 0 0 22px rgba(79,140,255,.6);
        opacity: 0; }
      #__wt_caption { position: fixed; left: 0; top: 0; max-width: 440px;
        padding: 12px 16px; border-radius: 12px;
        background: rgba(18,20,27,.93); color: #fff;
        box-shadow: 0 10px 36px rgba(0,0,0,.4); opacity: 0; backdrop-filter: blur(2px); }
      #__wt_caption b { color: #9cc1ff; }
      #__wt_cursor { position: fixed; left: 0; top: 0; width: 26px; height: 26px;
        margin: -3px 0 0 -3px; filter: drop-shadow(0 2px 3px rgba(0,0,0,.45)); }
      #__wt_cursor .ring { position: absolute; left: 2px; top: 2px;
        width: 22px; height: 22px; border-radius: 50%; border: 2px solid #4f8cff; opacity: 0; }
      #__wt_cursor.click .ring { animation: __wt_ripple .45s ease-out; }
      @keyframes __wt_ripple {
        from { transform: scale(.35); opacity: .85; }
        to   { transform: scale(2.6); opacity: 0; }
      }
    `;
    sr.appendChild(style);

    const root = document.createElement('div');
    root.id = '__wt_root';

    const spot = document.createElementNS(SVGNS, 'svg');
    spot.id = '__wt_spot';
    spot.innerHTML = `
      <defs>
        <mask id="__wt_mask">
          <rect x="0" y="0" width="100%" height="100%" fill="white"/>
          <rect id="__wt_hole" x="0" y="0" width="0" height="0" rx="10" fill="black"/>
        </mask>
      </defs>
      <rect x="0" y="0" width="100%" height="100%" fill="rgba(10,12,18,.55)" mask="url(#__wt_mask)"/>`;

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
    sr.appendChild(root);

    // Promote into the browser's TOP LAYER so the overlay paints over modal
    // <dialog>s / popovers / fullscreen, which a plain high z-index cannot beat.
    let asPopover = false;
    try {
      root.setAttribute('popover', 'manual');
      (root as unknown as { showPopover(): void }).showPopover();
      asPopover = true;
    } catch { /* old browser: falls back to z-index stacking */ }
    const raise = () => {
      if (!asPopover) return;
      try {
        const r = root as unknown as { hidePopover(): void; showPopover(): void };
        r.hidePopover(); r.showPopover();
      } catch { /* noop */ }
    };

    const hole = spot.querySelector('#__wt_hole')!;

    const state: { rect: Rect | null; cursor: { x: number; y: number }; alpha: number; captionText: string } = {
      rect: null,
      cursor: { x: window.innerWidth / 2, y: window.innerHeight * 0.82 },
      alpha: 0,
      captionText: '',
    };

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const lerpRect = (a: Rect, b: Rect, t: number): Rect => ({
      x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t),
    });
    const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

    function render() {
      cursor.style.transform = `translate(${state.cursor.x}px, ${state.cursor.y}px)`;
      if (state.rect) {
        const r = state.rect;
        const x = r.x - PAD, y = r.y - PAD, ww = r.w + 2 * PAD, hh = r.h + 2 * PAD;
        ring.style.left = x + 'px'; ring.style.top = y + 'px';
        ring.style.width = ww + 'px'; ring.style.height = hh + 'px';
        hole.setAttribute('x', String(x)); hole.setAttribute('y', String(y));
        hole.setAttribute('width', String(Math.max(0, ww))); hole.setAttribute('height', String(Math.max(0, hh)));
        ring.style.opacity = String(state.alpha);
        spot.style.opacity = String(state.alpha);
      } else {
        ring.style.opacity = '0';
        spot.style.opacity = '0';
      }
      caption.style.opacity = state.captionText ? String(state.alpha) : '0';
    }

    function animate(target: Target, duration: number): Promise<void> {
      return new Promise((resolve) => {
        const fromRect = state.rect;
        const fromCursor = { ...state.cursor };
        const fromAlpha = state.alpha;
        const toRect = target.rect !== undefined ? target.rect : state.rect;
        const toCursor = target.cursor || state.cursor;
        const toAlpha = target.alpha !== undefined ? target.alpha : state.alpha;
        const startRect = fromRect || toRect;

        const settle = () => {
          state.rect = toRect ?? null; state.cursor = { ...toCursor }; state.alpha = toAlpha;
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
          if (raw < 1) requestAnimationFrame(frame); else settle();
        })();
      });
    }

    function placeCaption(text: string | undefined, rect: Rect | null) {
      state.captionText = text || '';
      caption.innerHTML = state.captionText;
      const cw = Math.min(440, caption.scrollWidth || 440);
      let left = rect ? rect.x : window.innerWidth / 2 - cw / 2;
      left = Math.max(16, Math.min(left, window.innerWidth - cw - 16));
      caption.style.left = left + 'px';
      const below = rect ? rect.y + rect.h + PAD + 12 : window.innerHeight - 120;
      const ch = caption.offsetHeight || 64;
      const top = below + ch > window.innerHeight - 16 && rect ? rect.y - ch - PAD - 12 : below;
      caption.style.top = Math.max(16, top) + 'px';
    }

    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    w.__wt = {
      focus(rect: Rect, opts: { label?: string; duration?: number } = {}) {
        raise();
        placeCaption(opts.label, rect);
        const center = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
        return animate({ rect, cursor: center, alpha: 1 }, opts.duration || 0);
      },
      click(duration = 420) {
        cursor.classList.remove('click');
        void cursor.offsetWidth;
        cursor.classList.add('click');
        return wait(duration);
      },
      say(text: string, opts: { duration?: number } = {}) {
        raise();
        placeCaption(text, null);
        return animate({ rect: null, alpha: 1 }, opts.duration || 0);
      },
      async clear(opts: { duration?: number } = {}) {
        await animate({ alpha: 0 }, opts.duration || 0);
        state.rect = null; state.captionText = '';
        render();
      },
    };

    render();
  };

  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot, { once: true });
}
