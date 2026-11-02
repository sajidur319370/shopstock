import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import type { z } from 'zod';
import { UNITS, createProductSchema, type CreateProductInput, type ProductDto } from '@shopstock/shared';
import { http } from '@/api/client';
import { FormField } from '@/components/FormField';
import { MoneyInput } from '@/components/MoneyInput';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { applyServerErrors } from '@/lib/formErrors';
import { useCategories, useProduct } from './hooks';

type FormIn = z.input<typeof createProductSchema>;

/** /catalog/products/new and /catalog/products/:id/edit: one form, the shared schema validates both. */
export function ProductFormPage() {
  const { id } = useParams();
  const product = useProduct(id);
  if (id && product.isPending) return <p className="text-gray-500">Loading…</p>;
  if (id && !product.data) return <p className="text-red-600">Product not found.</p>;
  return <ProductForm current={product.data?.product} />;
}

function ProductForm({ current }: { current?: ProductDto }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const categories = useCategories();

  const { register, handleSubmit, control, setError, formState } = useForm<
    FormIn,
    unknown,
    CreateProductInput
  >({
    resolver: zodResolver(createProductSchema),
    defaultValues: current
      ? {
          sku: current.sku,
          barcode: current.barcode ?? '',
          name: current.name,
          categoryId: current.categoryId,
          price: current.price,
          unit: current.unit,
          reorderLevel: current.reorderLevel,
        }
      : { unit: 'pcs', reorderLevel: 0, barcode: '' },
  });

  const save = useMutation({
    mutationFn: (v: CreateProductInput) =>
      current
        ? http.patch<{ product: ProductDto }>(`/products/${current.id}`, v)
        : http.post<{ product: ProductDto }>('/products', v),
    onSuccess: async ({ product }) => {
      await qc.invalidateQueries({ queryKey: ['products'] });
      await qc.invalidateQueries({ queryKey: ['product', product.id] });
      toast.success(current ? 'Product saved' : `${product.name} created`);
      navigate(`/catalog/products/${product.id}`, { replace: true });
    },
  });
  const onSubmit = handleSubmit((v) =>
    save.mutateAsync(v).catch((e) =>
      applyServerErrors(e, setError, {
        SKU_TAKEN: 'sku',
        BARCODE_TAKEN: 'barcode',
        INVALID_CATEGORY: 'categoryId',
      }),
    ),
  );
  const { errors, isSubmitting } = formState;

  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-xl font-semibold">{current ? `Edit ${current.name}` : 'New product'}</h1>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormField id="name" label="Name" error={errors.name?.message}>
          <Input id="name" autoFocus {...register('name')} />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField id="sku" label="SKU" error={errors.sku?.message} hint="Your own code, e.g. RICE-5KG">
            <Input id="sku" className="font-mono uppercase" {...register('sku')} />
          </FormField>
          <FormField
            id="barcode"
            label="Barcode"
            error={errors.barcode?.message}
            hint="Optional: scan it here"
          >
            <Input id="barcode" className="font-mono" {...register('barcode')} />
          </FormField>
        </div>
        <FormField id="categoryId" label="Category" error={errors.categoryId?.message}>
          <Controller
            control={control}
            name="categoryId"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="categoryId" className="w-full">
                  <SelectValue placeholder="Choose a category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.data?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </FormField>
        <div className="grid grid-cols-3 gap-3">
          <FormField
            id="price"
            label="Price"
            error={errors.price && 'Enter a price, e.g. 185.00'}
            hint={current ? 'New sales use the new price; past sales keep theirs.' : undefined}
          >
            <Controller
              control={control}
              name="price"
              render={({ field }) => (
                <MoneyInput id="price" value={field.value ?? null} onChange={field.onChange} />
              )}
            />
          </FormField>
          <FormField id="unit" label="Unit" error={errors.unit?.message}>
            <Controller
              control={control}
              name="unit"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="unit" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNITS.map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>
          <FormField
            id="reorder"
            label="Reorder level"
            error={errors.reorderLevel?.message}
            hint="Default for new branches"
          >
            <Input
              id="reorder"
              type="number"
              min={0}
              {...register('reorderLevel', { valueAsNumber: true })}
            />
          </FormField>
        </div>
        {errors.root && <p className="text-sm text-red-600">{errors.root.message}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : current ? 'Save' : 'Create product'}
          </Button>
          <Button variant="outline" asChild>
            <Link to={current ? `/catalog/products/${current.id}` : '/catalog/products'}>Cancel</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}
