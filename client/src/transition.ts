/**
 * Screen transition, timed to match reference/transition-example.mp4:
 *
 *   flash in   ~100ms  page -> white
 *   hold       ~100ms  full white
 *   to black   ~270ms  white -> black
 *   loading    ...     black; a spinner shows only if loading takes a while
 *   reveal     ~250ms  black fades away to show the new page
 */

const TIMING = {
  flashIn: 100,
  flashHold: 100,
  toBlack: 270,
  /** Only show the spinner if the next page still isn't ready after this long on black. */
  spinnerDelay: 250,
  /** Once the spinner appears, keep it up at least this long so it doesn't blink. */
  spinnerMinVisible: 400,
  reveal: 250,
} as const;

const overlay = document.getElementById('transition') as HTMLDivElement;
const spinner = overlay.querySelector('.transition__spinner') as HTMLDivElement;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let busy = false;
export const isTransitioning = () => busy;

function setDurations(ms: number) {
  overlay.style.setProperty('--t', `${ms}ms`);
}

/**
 * Wait for `ready` while the screen is black. Shows the spinner
 * if loading outlasts `spinnerDelay`.
 */
async function holdUntilReady(ready: Promise<unknown>) {
  let done = false;
  const tracked = ready.finally(() => {
    done = true;
  });

  await Promise.race([tracked, wait(TIMING.spinnerDelay)]);
  if (!done) {
    spinner.classList.add('is-visible');
    await Promise.all([tracked, wait(TIMING.spinnerMinVisible)]);
    spinner.classList.remove('is-visible');
  }
  await tracked;
}

/** Fade the black cover away. */
export async function reveal() {
  setDurations(TIMING.reveal);
  spinner.classList.remove('is-visible');
  overlay.classList.remove('is-black', 'is-white');
  await wait(TIMING.reveal);
  overlay.classList.remove('is-active');
}

/** First page load: we start on black (set in index.html), so just wait and reveal. */
export async function bootReveal(ready: Promise<unknown>) {
  busy = true;
  overlay.classList.add('is-active');
  await holdUntilReady(ready);
  await reveal();
  busy = false;
}

/**
 * Run a full transition.
 * @param swap   called while the screen is fully black: tear down the old page,
 *               build the new one, and return a promise that resolves when
 *               the new page is ready to be seen.
 */
export async function transition(swap: () => Promise<unknown>) {
  if (busy) return;
  busy = true;
  overlay.classList.add('is-active');

  if (reducedMotion()) {
    // No white flash: a quick fade to black instead.
    setDurations(150);
    await nextFrame();
    overlay.classList.add('is-black');
    await wait(150);
  } else {
    // 1. Flash white
    setDurations(TIMING.flashIn);
    await nextFrame();
    overlay.classList.add('is-white');
    await wait(TIMING.flashIn + TIMING.flashHold);

    // 2. White -> black
    setDurations(TIMING.toBlack);
    overlay.classList.add('is-black');
    await wait(TIMING.toBlack);
    overlay.classList.remove('is-white');
  }

  // 3. Swap pages while black; spinner if it's slow
  await holdUntilReady(swap());

  // 4. Reveal
  await reveal();
  busy = false;
}
