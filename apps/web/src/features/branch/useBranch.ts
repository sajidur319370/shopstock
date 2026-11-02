import { createContext, useContext } from 'react';
import type { BranchSummaryDto } from '@shopstock/shared';

export const BranchContext = createContext<BranchSummaryDto | null>(null);

/** The branch of the current /b/:branchCode page (from the URL, checked against my branches). */
export function useBranch() {
  const b = useContext(BranchContext);
  if (!b) throw new Error('useBranch() outside a /b/:branchCode route');
  return b;
}
