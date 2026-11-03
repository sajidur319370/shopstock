import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import type { z } from 'zod';
import { supplierSchema, type SupplierDto, type SupplierInput } from '@shopstock/shared';
import { http } from '@/api/client';
import { FormField } from '@/components/FormField';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { applyServerErrors } from '@/lib/formErrors';
import { useSupplier } from './hooks';

type FormIn = z.input<typeof supplierSchema>;

/** /suppliers/new and /suppliers/:id/edit (FR-SUP-01). */
export function SupplierFormPage() {
  const { id } = useParams();
  const detail = useSupplier(id);
  if (id && detail.isPending) return <p className="text-gray-500">Loading…</p>;
  if (id && !detail.data) return <p className="text-red-600">Supplier not found.</p>;
  return <SupplierForm current={detail.data?.supplier} />;
}

function SupplierForm({ current }: { current?: SupplierDto }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { register, handleSubmit, setError, formState } = useForm<FormIn, unknown, SupplierInput>({
    resolver: zodResolver(supplierSchema),
    defaultValues: current
      ? {
          name: current.name,
          contactName: current.contactName,
          phone: current.phone,
          email: current.email,
          address: current.address,
          notes: current.notes,
        }
      : { name: '', contactName: '', phone: '', email: '', address: '', notes: '' },
  });

  const save = useMutation({
    // The edit sends every field: the form shows them all, so "unchanged" is a real value too.
    mutationFn: (v: SupplierInput) =>
      current
        ? http.patch<{ supplier: SupplierDto }>(`/suppliers/${current.id}`, v)
        : http.post<{ supplier: SupplierDto }>('/suppliers', v),
    onSuccess: async ({ supplier }) => {
      await qc.invalidateQueries({ queryKey: ['suppliers'] });
      await qc.invalidateQueries({ queryKey: ['supplier', supplier.id] });
      toast.success(current ? 'Supplier saved' : `${supplier.name} created`);
      navigate(`/suppliers/${supplier.id}`, { replace: true });
    },
  });
  const onSubmit = handleSubmit((v) =>
    save.mutateAsync(v).catch((e) => applyServerErrors(e, setError, { SUPPLIER_TAKEN: 'name' })),
  );
  const { errors, isSubmitting } = formState;

  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-xl font-semibold">{current ? `Edit ${current.name}` : 'New supplier'}</h1>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormField id="name" label="Name" error={errors.name?.message}>
          <Input id="name" autoFocus {...register('name')} />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField id="contactName" label="Contact person" error={errors.contactName?.message}>
            <Input id="contactName" {...register('contactName')} />
          </FormField>
          <FormField id="phone" label="Phone" error={errors.phone?.message}>
            <Input id="phone" type="tel" {...register('phone')} />
          </FormField>
        </div>
        <FormField id="email" label="Email" error={errors.email?.message}>
          <Input id="email" type="email" {...register('email')} />
        </FormField>
        <FormField id="address" label="Address" error={errors.address?.message}>
          <Input id="address" {...register('address')} />
        </FormField>
        <FormField
          id="notes"
          label="Notes"
          error={errors.notes?.message}
          hint="Payment terms, delivery days…"
        >
          <Textarea id="notes" rows={3} {...register('notes')} />
        </FormField>
        {errors.root && <p className="text-sm text-red-600">{errors.root.message}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : current ? 'Save' : 'Create supplier'}
          </Button>
          <Button variant="ghost" asChild>
            <Link to={current ? `/suppliers/${current.id}` : '/suppliers'}>Cancel</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}
