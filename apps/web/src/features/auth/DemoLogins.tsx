import { toast } from 'sonner';
import { DEMO_ACCOUNTS, type DemoAccount } from '@shopstock/shared';
import { Button } from '@/components/ui/button';
import { useDemoLogin } from './useAuthActions';

const ACCOUNTS: Record<DemoAccount, { role: string; scope: string; tryIt: string }> = {
  owner: { role: 'Owner', scope: 'All 3 branches', tryIt: 'Overview, reports for the last 30 days' },
  'manager.gul': { role: 'Manager', scope: 'Gulshan', tryIt: 'Receive the ordered PO, low stock → PO' },
  'manager.dhn': {
    role: 'Manager',
    scope: 'Dhanmondi + Uttara',
    tryIt: 'Branch switcher, receive the transfer in transit',
  },
  'cashier.gul': { role: 'Cashier', scope: 'Gulshan', tryIt: 'Scan, F9, Enter: a sale and a receipt' },
};

/** The public demo (DEMO_MODE): one click per role, no password to type or share. */
export function DemoLogins({ returnTo }: { returnTo: string }) {
  const demo = useDemoLogin(returnTo);
  const pending = demo.isPending ? demo.variables : null;

  return (
    <section aria-labelledby="demo-heading" className="mt-6 border-t pt-4">
      <h2 id="demo-heading" className="text-sm font-medium">
        Try the demo
      </h2>
      <p className="mb-3 text-sm text-gray-500">
        Log in as any role with one click. The data resets now and then.
      </p>
      <div className="grid gap-2">
        {DEMO_ACCOUNTS.map((account) => {
          const a = ACCOUNTS[account];
          return (
            <Button
              key={account}
              type="button"
              variant="outline"
              className="h-auto justify-start py-2 text-left whitespace-normal"
              disabled={demo.isPending}
              onClick={() =>
                demo.mutate(account, {
                  onError: (e) => toast.error(e instanceof Error ? e.message : 'Demo login failed.'),
                })
              }
            >
              <span className="flex flex-col items-start">
                <span className="font-medium">
                  {pending === account ? 'Logging in…' : `${a.role} · ${a.scope}`}
                </span>
                <span className="text-xs font-normal text-gray-500">{a.tryIt}</span>
              </span>
            </Button>
          );
        })}
      </div>
    </section>
  );
}
