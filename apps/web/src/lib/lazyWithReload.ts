import { lazy, type ComponentType } from 'react';

const KEY = 'ss_chunk_reload';

/** True the FIRST time only (and remembers it for this tab); false after a reload, or without storage. */
function firstReload(): boolean {
  try {
    if (sessionStorage.getItem(KEY) === '1') return false;
    sessionStorage.setItem(KEY, '1');
    return true;
  } catch {
    return false; // storage blocked: don't risk a reload loop
  }
}

/**
 * React.lazy that survives a deploy: a tab opened before the deploy still has the OLD index.html, whose
 * chunk names no longer exist on the server. On the first failed import, reload once (fetching the new
 * index.html); a second failure is a real error and is thrown.
 */
export function lazyWithReload<T extends ComponentType>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const mod = await load();
      try {
        sessionStorage.removeItem(KEY); // loaded fine: a later deploy may reload once again
      } catch {
        /* storage blocked: nothing to clear */
      }
      return mod;
    } catch (err) {
      if (!firstReload()) throw err;
      window.location.reload();
      return new Promise<never>(() => {}); // the page is going away
    }
  });
}
