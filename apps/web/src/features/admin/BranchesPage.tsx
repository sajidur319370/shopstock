import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { z } from 'zod';
import { branchFieldsSchema, createBranchSchema, type BranchDto } from '@shopstock/shared';
import { http } from '@/api/client';
import { qk } from '@/api/keys';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FormField } from '@/components/FormField';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { applyServerErrors } from '@/lib/formErrors';

export function useBranches() {
  return useQuery({
    queryKey: qk.branches,
    queryFn: () => http.get<{ branches: BranchDto[] }>('/branches').then((r) => r.branches),
  });
}

/** After any branch write: the table AND the branch switcher (it reads me.branches). */
function useInvalidateBranches() {
  const qc = useQueryClient();
  return () =>
    Promise.all([qc.invalidateQueries({ queryKey: qk.branches }), qc.invalidateQueries({ queryKey: qk.me })]);
}

type DialogState = { mode: 'create' } | { mode: 'edit'; branch: BranchDto } | null;

export function BranchesPage() {
  const branches = useBranches();
  const invalidate = useInvalidateBranches();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [toggling, setToggling] = useState<BranchDto | null>(null);

  const setActive = useMutation({
    mutationFn: (b: BranchDto) => http.patch(`/branches/${b.id}`, { isActive: !b.isActive }),
    onSuccess: async (_res, b) => {
      await invalidate();
      toast.success(`${b.code} ${b.isActive ? 'deactivated' : 'reactivated'}`);
      setToggling(null);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Branches</h1>
        <Button onClick={() => setDialog({ mode: 'create' })}>New branch</Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead>
            <TableHead>Name</TableHead>
            <TableHead className="hidden md:table-cell">Address</TableHead>
            <TableHead className="hidden md:table-cell">Phone</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {branches.isPending && (
            <TableRow>
              <TableCell colSpan={6} className="text-gray-500">
                Loading…
              </TableCell>
            </TableRow>
          )}
          {branches.data?.map((b) => (
            <TableRow key={b.id}>
              <TableCell className="font-mono font-medium">{b.code}</TableCell>
              <TableCell>{b.name}</TableCell>
              <TableCell className="hidden md:table-cell">{b.address || '—'}</TableCell>
              <TableCell className="hidden md:table-cell">{b.phone || '—'}</TableCell>
              <TableCell>
                {b.isActive ? (
                  <Badge variant="secondary">Active</Badge>
                ) : (
                  <Badge variant="outline">Inactive</Badge>
                )}
              </TableCell>
              <TableCell className="space-x-2 text-right">
                <Button size="sm" variant="outline" onClick={() => setDialog({ mode: 'edit', branch: b })}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setToggling(b)}>
                  {b.isActive ? 'Deactivate' : 'Reactivate'}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {dialog?.mode === 'create' && (
        <CreateBranchDialog onClose={() => setDialog(null)} onSaved={invalidate} />
      )}
      {dialog?.mode === 'edit' && (
        <EditBranchDialog branch={dialog.branch} onClose={() => setDialog(null)} onSaved={invalidate} />
      )}
      <ConfirmDialog
        open={!!toggling}
        onOpenChange={(o) => !o && setToggling(null)}
        title={toggling?.isActive ? `Deactivate ${toggling.code}?` : `Reactivate ${toggling?.code}?`}
        description={
          toggling?.isActive
            ? `Cashiers at ${toggling.code} won't be able to sell. Existing data stays.`
            : `Staff assigned to ${toggling?.code} can work there again.`
        }
        confirmLabel={toggling?.isActive ? 'Deactivate' : 'Reactivate'}
        destructive={toggling?.isActive}
        pending={setActive.isPending}
        onConfirm={() => toggling && setActive.mutate(toggling)}
      />
    </div>
  );
}

type CreateForm = z.input<typeof createBranchSchema>;
type CreateValues = z.output<typeof createBranchSchema>;

function CreateBranchDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<unknown> }) {
  const { register, handleSubmit, setError, formState } = useForm<CreateForm, unknown, CreateValues>({
    resolver: zodResolver(createBranchSchema),
  });
  const create = useMutation({
    mutationFn: (v: CreateValues) => http.post<{ branch: BranchDto }>('/branches', v),
    onSuccess: async ({ branch }) => {
      await onSaved();
      toast.success(`Branch ${branch.code} created`);
      onClose();
    },
  });
  const onSubmit = handleSubmit((v) =>
    create.mutateAsync(v).catch((e) => applyServerErrors(e, setError, { BRANCH_CODE_TAKEN: 'code' })),
  );
  const { errors, isSubmitting } = formState;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New branch</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormField
            id="code"
            label="Code"
            error={errors.code?.message}
            hint="Can't be changed later: it's part of every invoice number (GUL-000001)."
          >
            <Input id="code" autoFocus className="uppercase" maxLength={8} {...register('code')} />
          </FormField>
          <FormField id="name" label="Name" error={errors.name?.message}>
            <Input id="name" {...register('name')} />
          </FormField>
          <FormField id="address" label="Address" error={errors.address?.message}>
            <Input id="address" {...register('address')} />
          </FormField>
          <FormField id="phone" label="Phone" error={errors.phone?.message}>
            <Input id="phone" {...register('phone')} />
          </FormField>
          {errors.root && <p className="text-sm text-red-600">{errors.root.message}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating…' : 'Create branch'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const editSchema = branchFieldsSchema.pick({ name: true, address: true, phone: true });
type EditForm = z.input<typeof editSchema>;
type EditValues = z.output<typeof editSchema>;

function EditBranchDialog(props: {
  branch: BranchDto;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const { branch, onClose, onSaved } = props;
  const { register, handleSubmit, setError, formState } = useForm<EditForm, unknown, EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { name: branch.name, address: branch.address, phone: branch.phone },
  });
  const save = useMutation({
    mutationFn: (v: EditValues) => http.patch<{ branch: BranchDto }>(`/branches/${branch.id}`, v),
    onSuccess: async () => {
      await onSaved();
      toast.success(`${branch.code} saved`);
      onClose();
    },
  });
  const onSubmit = handleSubmit((v) => save.mutateAsync(v).catch((e) => applyServerErrors(e, setError)));
  const { errors, isSubmitting } = formState;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {branch.code}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormField id="name" label="Name" error={errors.name?.message}>
            <Input id="name" autoFocus {...register('name')} />
          </FormField>
          <FormField id="address" label="Address" error={errors.address?.message}>
            <Input id="address" {...register('address')} />
          </FormField>
          <FormField id="phone" label="Phone" error={errors.phone?.message}>
            <Input id="phone" {...register('phone')} />
          </FormField>
          {errors.root && <p className="text-sm text-red-600">{errors.root.message}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
