import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { useActor } from '@/features/auth/useActor';
import { branchHome } from '@/layout/nav';

/** Same wording whether the branch is someone else's or doesn't exist (the API answers 404 for both). */
export function BranchUnavailable({ code, inactive = false }: { code: string; inactive?: boolean }) {
  const { branches, user } = useActor();
  const open = branches.filter((b) => b.isActive);

  return (
    <div className="mx-auto max-w-md space-y-4 py-16 text-center">
      <h1 className="text-xl font-semibold">Branch not available</h1>
      <p className="text-gray-600">
        {inactive
          ? `Branch ${code.toUpperCase()} is inactive.`
          : `You don't have access to branch ${code.toUpperCase()} (or it doesn't exist).`}
      </p>
      {open.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2">
          {open.map((b) => (
            <Button key={b.id} variant="outline" asChild>
              <Link to={branchHome(user.role, b.code)}>
                {b.code} · {b.name}
              </Link>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
