// konfetti as an app: registers the service worker (sw.js), and offers, politely and not often, to
// put konfetti on the home screen. Chrome and Edge have an install prompt to call; Safari on iOS has
// none, so there the card says how to do it by hand. The card's styles are in pwa.css.
const KEY = 'konfetti.install';      // localStorage: until when not to offer again, in ms since 1970
const QUIET = 30 * 24 * 3600 * 1000; // after "not now", ask again in a month
const DELAY = 4000;                  // ms: the editor comes first, then the offer

// Safari's Share glyph, a box with an arrow out of the top; the word Share is beside it for screen readers.
const SHARE = '<svg class="pwa-share" viewBox="0 0 20 24" aria-hidden="true"><path d="M10 15V2.5M5.5 7 10 2.5 14.5 7M7 10H3.5v11.5h13V10H13" '
  + 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function initPwa() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1); // iPadOS says Macintosh
  const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let deferred = null, card = null, kind = null, quietUntil = 0;
  const readyAt = performance.now() + DELAY;

  try { quietUntil = Number(localStorage.getItem(KEY)) || 0; } catch {} // storage blocked: remember for this visit only
  const quiet = () => quietUntil > Date.now();
  function rest() {
    quietUntil = Date.now() + QUIET;
    try { localStorage.setItem(KEY, String(quietUntil)); } catch {}
  }

  register();

  /** Puts the card up: 'prompt' with an Install button, or 'ios' with the steps. */
  function show(what = deferred ? 'prompt' : 'ios') {
    hide();
    kind = what;
    card = document.createElement('section');
    card.className = 'pwa';
    card.setAttribute('aria-label', 'Install konfetti');
    const icon = new URL('icons/icon-192.png', import.meta.url);
    const how = what === 'ios' ? `Tap Share ${SHARE} then <b>Add to Home Screen</b>.` : 'Full screen, and it works offline.';
    card.innerHTML = `<img class="pwa-icon" src="${icon}" alt="" width="40" height="40">`
      + `<p class="pwa-text"><strong>konfetti on your home screen</strong> <span>${how}</span></p>`
      + (what === 'prompt' ? '<button class="go pwa-go" aria-label="Install konfetti">Install</button>' : '')
      + '<button class="small pwa-x" aria-label="Not now" title="Not now"><span aria-hidden="true">✕</span></button>';
    card.querySelector('.pwa-x').onclick = () => { rest(); hide(); };
    if (what === 'prompt') card.querySelector('.pwa-go').onclick = install;
    document.body.append(card);
  }
  function hide() {
    card?.remove();
    card = kind = null;
  }
  // Waits for the editor to settle, then shows the card if there is anything to offer.
  function offer() {
    if (card || installed() || quiet() || !(deferred || ios)) return;
    const wait = readyAt - performance.now();
    if (wait > 0) return void setTimeout(offer, wait);
    show();
    if (kind === 'ios') rest(); // a hint said once is enough: no API tells us whether it was followed
  }
  async function install() {
    const p = deferred;
    deferred = null;
    hide();
    if (!p) return;
    p.prompt();
    const choice = await p.userChoice.catch(() => null);
    if (!choice || choice.outcome !== 'accepted') rest(); // said no in the browser's own dialog: as good as "not now"
  }

  addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); // our card instead of the browser's banner
    deferred = e;
    offer();
  });
  addEventListener('appinstalled', () => {
    deferred = null;
    rest();
    hide();
  });
  offer();

  // For tests: show() and hide() bypass the delay and the dismissal; state() says what is going on.
  return {
    show, hide,
    state: () => ({ kind, shown: !!card, installed: installed(), ios, canPrompt: !!deferred, quiet: quiet(),
                    worker: navigator.serviceWorker?.controller ? 'controlling' : 'none' }),
  };
}

/** Registers sw.js where that is allowed: https or localhost. Elsewhere the editor works as before. */
function register() {
  if (!isSecureContext || !('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  // On a first visit the page loaded before the worker existed, so the worker never saw those files.
  // Once it takes over, tell it what was loaded, so that the next start works offline.
  sw.addEventListener('controllerchange', () => sw.controller?.postMessage({
    loaded: [location.href, ...performance.getEntriesByType('resource').map(r => r.name)],
  }));
  sw.register(new URL('sw.js', import.meta.url)).catch(() => {});
}
