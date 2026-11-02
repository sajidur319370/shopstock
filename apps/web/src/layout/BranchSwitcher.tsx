import { useLocation, useNavigate } from 'react-router';
import { ChevronsUpDownIcon } from 'lucide-react';
import type { BranchSummaryDto } from '@shopstock/shared';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useActor } from '@/features/auth/useActor';
import { rememberBranch } from '@/lib/lastBranch';
import { branchHome } from './nav';

const label = (b: BranchSummaryDto) => `${b.code} · ${b.name}`;

/**
 * Switching keeps the page TYPE: /b/GUL/inventory/123 → /b/DHN/inventory (ids belong to a branch,
 * so they're dropped). From a shop page it opens the branch's home page.
 */
export function BranchSwitcher({ current }: { current?: string }) {
  const { branches, user } = useActor();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const currentBranch = branches.find((b) => b.code === current);

  if (branches.length === 0) return <span className="text-sm text-gray-500">No branch assigned</span>;
  if (branches.length === 1) {
    return <span className="rounded-md border px-3 py-1.5 text-sm">{label(branches[0]!)}</span>;
  }

  const go = (code: string) => {
    rememberBranch(code);
    const section = /^\/b\/[^/]+\/([^/]+)/.exec(pathname)?.[1];
    navigate(section ? `/b/${code}/${section}` : branchHome(user.role, code));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          {currentBranch ? label(currentBranch) : 'Choose branch'}
          <ChevronsUpDownIcon className="size-4 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Branches</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {branches.map((b) => (
          <DropdownMenuItem
            key={b.id}
            disabled={!b.isActive && user.role !== 'owner'} // the Owner may still open it read-only
            onSelect={() => go(b.code)}
            className={b.code === current ? 'font-medium' : undefined}
          >
            {label(b)}
            {!b.isActive && <span className="ml-auto text-xs text-gray-500">inactive</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
