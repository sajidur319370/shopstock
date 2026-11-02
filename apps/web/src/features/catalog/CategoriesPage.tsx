import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { categoryNameSchema, type CategoryDto } from '@shopstock/shared';
import { ApiError, http } from '@/api/client';
import { qk } from '@/api/keys';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCategories } from './hooks';

const message = (e: unknown) => {
  if (e instanceof ApiError && e.code === 'CATEGORY_IN_USE') return 'Move or archive its products first.';
  return e instanceof Error ? e.message : 'Something went wrong';
};

export function CategoriesPage() {
  const categories = useCategories();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: qk.categories });

  const create = useMutation({
    mutationFn: (n: string) => http.post('/categories', { name: n }),
    onSuccess: async () => {
      await refresh();
      setName('');
      setError(null);
    },
    onError: (e) => setError(message(e)),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = categoryNameSchema.safeParse(name);
    if (!parsed.success) return setError('1–40 characters');
    create.mutate(parsed.data);
  };

  return (
    <div className="max-w-lg space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Categories</h1>
        <Button variant="outline" asChild>
          <Link to="/catalog/products">Products</Link>
        </Button>
      </div>
      <form onSubmit={submit} className="flex gap-2" noValidate>
        <Input
          aria-label="New category"
          placeholder="New category"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" disabled={create.isPending}>
          Add
        </Button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <ul className="divide-y rounded-md border">
        {categories.data?.map((c) => (
          <CategoryRow key={c.id} category={c} onChanged={refresh} />
        ))}
        {categories.data?.length === 0 && <li className="p-3 text-sm text-gray-500">No categories yet.</li>}
      </ul>
    </div>
  );
}

function CategoryRow({ category, onChanged }: { category: CategoryDto; onChanged: () => Promise<unknown> }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const rename = useMutation({
    mutationFn: () => http.patch(`/categories/${category.id}`, { name: name.trim() }),
    onSuccess: async () => {
      await onChanged();
      setEditing(false);
    },
    onError: (e) => toast.error(message(e)),
  });
  const remove = useMutation({
    mutationFn: () => http.delete(`/categories/${category.id}`),
    onSuccess: async () => {
      await onChanged();
      toast.success(`${category.name} deleted`);
    },
    onError: (e) => toast.error(message(e)),
  });

  return (
    <li className="flex items-center gap-2 p-2">
      {editing ? (
        <form
          className="flex flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            rename.mutate();
          }}
        >
          <Input
            aria-label="Category name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button size="sm" type="submit" disabled={rename.isPending}>
            Save
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <>
          <span className="flex-1 px-1">{category.name}</span>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Rename
          </Button>
          <Button size="sm" variant="ghost" onClick={() => remove.mutate()} disabled={remove.isPending}>
            Delete
          </Button>
        </>
      )}
    </li>
  );
}
