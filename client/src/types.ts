export interface Page {
  /** Root element of the page. */
  el: HTMLElement;
  /** Resolves when the page is ready to be shown (e.g. video can play). */
  ready: Promise<void>;
  /** Called once the transition has fully revealed the page. */
  onShow?: () => void;
  /** Clean up listeners/media when leaving the page. */
  destroy?: () => void;
}

export interface PageModule {
  createPage: () => Page;
}
