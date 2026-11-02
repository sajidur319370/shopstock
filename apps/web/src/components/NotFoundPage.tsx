import { Link } from 'react-router';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <main className="grid min-h-screen place-items-center p-4 text-center">
      <div className="space-y-3">
        <p className="text-5xl font-bold text-gray-300">404</p>
        <h1 className="text-xl font-semibold">Page not found</h1>
        <Button asChild variant="outline">
          <Link to="/">Go home</Link>
        </Button>
      </div>
    </main>
  );
}
