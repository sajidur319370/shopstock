import { NavLink, Outlet, useMatch } from 'react-router';
import { MenuIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useActor } from '@/features/auth/useActor';
import { lastBranch } from '@/lib/lastBranch';
import { BranchSwitcher } from './BranchSwitcher';
import { UserMenu } from './UserMenu';
import { NAV } from './nav';

export function AppShell() {
  const { branches, settings, can } = useActor();
  // useParams() can't see :branchCode here: this layout is the PARENT of /b/:branchCode.
  const match = useMatch('/b/:branchCode/*');
  const urlCode = match?.params.branchCode?.toUpperCase();
  const current = urlCode ?? lastBranch(branches); // shop pages remember the last branch
  const items = NAV.filter((i) => can(i.permission) && (i.scope === 'shop' || current));
  const links = items.map((i) => ({ ...i, href: i.to(current ?? '') }));

  return (
    <div className="grid min-h-screen grid-rows-[auto_1fr] md:grid-cols-[220px_1fr] print:block">
      <header className="col-span-full flex items-center gap-3 border-b px-4 py-2 print:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Menu">
              <MenuIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {links.map((l) => (
              <DropdownMenuItem key={l.label} asChild>
                <NavLink to={l.href}>{l.label}</NavLink>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="font-semibold">{settings.shopName}</span>
        <BranchSwitcher current={current} />
        <div className="ml-auto">
          <UserMenu />
        </div>
      </header>
      <nav className="hidden space-y-0.5 border-r p-3 md:block print:hidden">
        {links.map((l, i) => (
          <div key={l.label}>
            {l.scope === 'shop' && links[i - 1]?.scope === 'branch' && (
              <p className="mt-4 mb-1 px-3 text-xs font-medium tracking-wide text-gray-500 uppercase">Shop</p>
            )}
            <NavLink
              to={l.href}
              className={({ isActive }) =>
                cn(
                  'block rounded-md px-3 py-2 text-sm hover:bg-gray-50',
                  isActive && 'bg-gray-100 font-medium',
                )
              }
            >
              {l.label}
            </NavLink>
          </div>
        ))}
      </nav>
      <main className="min-w-0 p-4 md:p-6 print:p-0">
        <Outlet />
      </main>
    </div>
  );
}
