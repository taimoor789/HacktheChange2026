import { bootReveal, isTransitioning, transition } from './transition';
import type { Page, PageModule } from './types';

interface Route {
  load: () => Promise<PageModule>;
  /**
   * If set, this page can only be entered by pressing a button on one of
   * these pages. Typing the URL, refreshing, or a script calling
   * history.pushState sends you back to the home page instead.
   */
  from?: string[];
  /** Lock the page again once you leave it (back/forward can't return to it). */
  once?: boolean;
}

/**
 * Add new screens here. Each page is lazy-loaded, so its code and
 * assets load during the black part of the transition.
 */
const routes: Record<string, Route> = {
  '/': { load: () => import('./pages/home') },
  '/select': { load: () => import('./pages/select'), from: ['/'] },
  // Needs two matched players. No matchmaking yet: use the test code (see popup.ts).
  '/game': { load: () => import('./pages/game'), from: ['/select'], once: true },
};

const HOME = '/';
const app = document.getElementById('app') as HTMLElement;
let current: Page | null = null;
let currentPath: string | null = null;

/** Pages unlocked by a real button press this session (lets back/forward work). */
const unlocked = new Set<string>([HOME]);

function known(path: string) {
  return routes[path] ? path : HOME;
}

/** Where a request for `path` is actually allowed to go. */
function allowed(path: string, viaButtonFrom: string | null) {
  const target = known(path);
  const route = routes[target];
  if (!route.from) return target;
  if (viaButtonFrom && route.from.includes(viaButtonFrom)) {
    unlocked.add(target);
    return target;
  }
  return unlocked.has(target) ? target : HOME;
}

function shown() {
  current?.onShow?.();
}

/** Build the page for `path`, swap it in, and resolve once it's ready to show. */
async function mount(path: string) {
  const mod = await routes[path].load();
  current?.destroy?.();
  if (currentPath && currentPath !== path && routes[currentPath].once) unlocked.delete(currentPath);
  app.replaceChildren();
  current = mod.createPage();
  currentPath = path;
  app.appendChild(current.el);
  await current.ready;
}

/**
 * Go to a screen with the flash transition. Only call this from a
 * user's button press — that press is what unlocks guarded pages.
 */
export function navigate(path: string) {
  if (isTransitioning()) return;
  const target = allowed(path, currentPath);
  if (target === currentPath) return;
  history.pushState(null, '', target);
  void transition(() => mount(target)).then(shown);
}

export function startRouter() {
  // Any element with data-nav="/path" navigates on a real (user) click.
  document.addEventListener('click', (e) => {
    const el = (e.target as Element).closest<HTMLElement>('[data-nav]');
    if (!el || !e.isTrusted) return;
    e.preventDefault();
    navigate(el.dataset.nav!);
  });

  // Browser back/forward: only to pages already unlocked this session.
  window.addEventListener('popstate', () => {
    const target = allowed(location.pathname, null);
    if (target !== location.pathname) history.replaceState(null, '', target);
    if (target === currentPath) return;
    void transition(() => mount(target)).then(shown);
  });

  // First load / refresh / typed URL: guarded pages bounce to home.
  const start = allowed(location.pathname, null);
  if (start !== location.pathname) history.replaceState(null, '', start);
  void bootReveal(mount(start)).then(shown);
}
