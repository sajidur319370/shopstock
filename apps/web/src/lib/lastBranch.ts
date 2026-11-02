import type { BranchSummaryDto } from '@shopstock/shared';

const KEY = 'shopstock:lastBranch';

/** Shop pages and the next login reopen the branch you used last. Storage can be blocked: never throw. */
export function rememberBranch(code: string) {
  try {
    localStorage.setItem(KEY, code);
  } catch {
    /* private mode / blocked storage: just don't remember */
  }
}

/** The remembered branch if it's still one of mine and active, else my first active branch. */
export function lastBranch(branches: BranchSummaryDto[]): string | undefined {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    /* ignore */
  }
  const active = branches.filter((b) => b.isActive);
  return (active.find((b) => b.code === saved) ?? active[0] ?? branches[0])?.code;
}
