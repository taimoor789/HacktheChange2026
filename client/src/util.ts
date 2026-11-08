/** Parse an HTML string into a single element. */
export function html<T extends HTMLElement = HTMLElement>(markup: string): T {
  const tpl = document.createElement('template');
  tpl.innerHTML = markup.trim();
  return tpl.content.firstElementChild as T;
}

/** Resolve after `ms`, or when `p` settles — whichever is first. Never rejects. */
export function withTimeout(p: Promise<unknown>, ms: number): Promise<void> {
  return Promise.race([
    p.then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((r) => setTimeout(r, ms)),
  ]);
}

/** Resolve when an image has loaded (or failed — we don't block on broken art). */
export function imageReady(src: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = img.onerror = () => resolve();
    img.src = src;
  });
}

/** Resolve when a video has enough data to start playing smoothly. */
export function videoReady(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return resolve();
    const done = () => {
      video.removeEventListener('canplay', done);
      video.removeEventListener('error', done);
      resolve();
    };
    video.addEventListener('canplay', done);
    video.addEventListener('error', done);
  });
}
