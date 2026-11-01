import { ROLES } from '@shopstock/shared';

export default function App() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">ShopStock</h1>
      <p className="text-gray-600">Roles: {ROLES.join(', ')}</p>
    </main>
  );
}
