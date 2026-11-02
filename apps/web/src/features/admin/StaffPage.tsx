import { useState, type ReactNode } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  assignableRoles,
  createStaffSchema,
  type BranchSummaryDto,
  type StaffDto,
  type StaffRole,
} from '@shopstock/shared';
import { ApiError, http } from '@/api/client';
import { qk } from '@/api/keys';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FormField } from '@/components/FormField';
import { OneTimeSecretDialog } from '@/components/OneTimeSecretDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useActor } from '@/features/auth/useActor';
import { applyServerErrors } from '@/lib/formErrors';
import { generateTempPassword } from '@/lib/tempPassword';

const FORBIDDEN_MSG = 'You can only manage cashiers of your branches.';
const toastError = (e: unknown) =>
  toast.error(e instanceof ApiError && e.status === 403 ? FORBIDDEN_MSG : (e as Error).message);

type Secret = { title: string; secret: string; note: string };
type Editing = { mode: 'create' } | { mode: 'edit'; staff: StaffDto } | null;

export function StaffPage() {
  const { user, branches } = useActor();
  const qc = useQueryClient();
  const staff = useQuery({
    queryKey: qk.staff,
    queryFn: () => http.get<{ staff: StaffDto[] }>('/staff').then((r) => r.staff),
  });
  const [editing, setEditing] = useState<Editing>(null);
  const [secret, setSecret] = useState<Secret | null>(null);
  const [toggling, setToggling] = useState<StaffDto | null>(null);
  const [resetting, setResetting] = useState<StaffDto | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: qk.staff });

  const codeOf = new Map(branches.map((b) => [b.id, b.code]));
  const myBranchIds = new Set(branches.map((b) => b.id));
  /** Mirrors the API's role ceiling, so we can disable buttons with a reason. The API still decides. */
  const whyNot = (s: StaffDto): string | null => {
    if (s.id === user.id) return "You can't change your own access. Ask the owner.";
    if (s.role === 'owner') return 'The owner account cannot be changed here.';
    if (user.role === 'owner') return null;
    if (s.role !== 'cashier' || !s.branchIds.every((id) => myBranchIds.has(id))) return FORBIDDEN_MSG;
    return null;
  };

  const setActive = useMutation({
    mutationFn: (s: StaffDto) => http.patch(`/staff/${s.id}`, { isActive: !s.isActive }),
    onSuccess: async (_r, s) => {
      await refresh();
      toast.success(s.isActive ? `${s.name} deactivated and logged out` : `${s.name} reactivated`);
      setToggling(null);
    },
    onError: toastError,
  });

  const reset = useMutation({
    mutationFn: async (s: StaffDto) => {
      const temporaryPassword = generateTempPassword();
      await http.post(`/staff/${s.id}/reset-password`, { temporaryPassword });
      return { s, temporaryPassword };
    },
    onSuccess: async ({ s, temporaryPassword }) => {
      await refresh();
      setResetting(null);
      setSecret({
        title: `New temporary password for ${s.name}`,
        secret: temporaryPassword,
        note: `Give this to ${s.name}. They were logged out everywhere and will choose their own password at the next login.`,
      });
    },
    onError: toastError,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Staff</h1>
        <Button onClick={() => setEditing({ mode: 'create' })}>Add staff</Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="hidden md:table-cell">Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Branches</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden lg:table-cell">Last login</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {staff.isPending && (
            <TableRow>
              <TableCell colSpan={7} className="text-gray-500">
                Loading…
              </TableCell>
            </TableRow>
          )}
          {staff.data?.map((s) => {
            const blocked = whyNot(s);
            const codes = s.branchIds.map((id) => codeOf.get(id)).filter(Boolean);
            const hidden = s.branchIds.length - codes.length;
            return (
              <TableRow key={s.id} className={s.isActive ? undefined : 'text-gray-400'}>
                <TableCell className="font-medium">
                  {s.name}
                  {s.id === user.id && <span className="ml-1 text-xs text-gray-500">(you)</span>}
                </TableCell>
                <TableCell className="hidden md:table-cell">{s.email}</TableCell>
                <TableCell className="capitalize">{s.role}</TableCell>
                <TableCell className="font-mono text-xs">
                  {s.role === 'owner' ? 'all' : codes.join(', ')}
                  {hidden > 0 && <span className="text-gray-500"> +{hidden} other</span>}
                </TableCell>
                <TableCell className="space-x-1">
                  {!s.isActive && <Badge variant="outline">Inactive</Badge>}
                  {s.isActive && s.mustChangePassword && <Badge variant="secondary">Must set password</Badge>}
                  {s.isActive && !s.mustChangePassword && <Badge variant="secondary">Active</Badge>}
                </TableCell>
                <TableCell className="hidden text-sm lg:table-cell">
                  {s.lastLoginAt ? new Date(s.lastLoginAt).toLocaleString() : 'never'}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <Guarded reason={blocked}>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditing({ mode: 'edit', staff: s })}
                    >
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setResetting(s)}>
                      Reset password
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setToggling(s)}>
                      {s.isActive ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  </Guarded>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {editing && (
        <StaffFormDialog
          editing={editing}
          onClose={() => setEditing(null)}
          onSaved={async (created) => {
            await refresh();
            setEditing(null);
            if (created) {
              setSecret({
                title: `${created.name} can log in now`,
                secret: created.password,
                note: `Give this temporary password to ${created.name}. They'll choose their own at first login.`,
              });
            } else toast.success('Saved');
          }}
        />
      )}
      {secret && <OneTimeSecretDialog {...secret} onClose={() => setSecret(null)} />}
      <ConfirmDialog
        open={!!toggling}
        onOpenChange={(o) => !o && setToggling(null)}
        title={toggling?.isActive ? `Deactivate ${toggling.name}?` : `Reactivate ${toggling?.name}?`}
        description={
          toggling?.isActive
            ? `${toggling.name} will be logged out everywhere immediately.`
            : `${toggling?.name} will be able to log in again.`
        }
        confirmLabel={toggling?.isActive ? 'Deactivate' : 'Reactivate'}
        destructive={toggling?.isActive}
        pending={setActive.isPending}
        onConfirm={() => toggling && setActive.mutate(toggling)}
      />
      <ConfirmDialog
        open={!!resetting}
        onOpenChange={(o) => !o && setResetting(null)}
        title={`Reset ${resetting?.name}'s password?`}
        description="A new temporary password is generated and shown once. They'll be logged out everywhere."
        confirmLabel="Reset password"
        pending={reset.isPending}
        onConfirm={() => resetting && reset.mutate(resetting)}
      />
    </div>
  );
}

/** Disabled buttons + a tooltip saying WHY (disabled buttons don't fire hover events, so wrap them). */
function Guarded({ reason, children }: { reason: string | null; children: ReactNode }) {
  if (!reason) return <div className="inline-flex gap-1">{children}</div>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex gap-1 opacity-50 [&_button]:pointer-events-none" tabIndex={0}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

const cashierOneBranch = <T extends { role: StaffRole; branchIds: string[] }>(v: T) =>
  v.role !== 'cashier' || v.branchIds.length === 1;
const ONE_BRANCH = { path: ['branchIds'], message: 'A cashier works at exactly one branch.' };

const createForm = createStaffSchema.refine(cashierOneBranch, ONE_BRANCH);
const editForm = createStaffSchema
  .pick({ name: true, role: true, branchIds: true })
  .refine(cashierOneBranch, ONE_BRANCH);
type FormValues = z.infer<typeof createForm>;

function StaffFormDialog(props: {
  editing: Exclude<Editing, null>;
  onClose: () => void;
  onSaved: (created?: { name: string; password: string }) => Promise<void>;
}) {
  const { user, branches } = useActor();
  const isEdit = props.editing.mode === 'edit';
  const current = props.editing.mode === 'edit' ? props.editing.staff : null;
  const roles = assignableRoles(user.role);

  const { register, handleSubmit, setError, setValue, control, formState } = useForm<FormValues>({
    // In edit mode email/password aren't part of the form: validate the smaller schema.
    resolver: zodResolver(isEdit ? (editForm as unknown as typeof createForm) : createForm),
    defaultValues: current
      ? { name: current.name, role: current.role as StaffRole, branchIds: current.branchIds }
      : { role: roles[roles.length - 1], branchIds: [], temporaryPassword: generateTempPassword() },
  });
  const role = useWatch({ control, name: 'role' });

  const save = useMutation({
    mutationFn: (v: FormValues) =>
      current
        ? http.patch(`/staff/${current.id}`, { name: v.name, role: v.role, branchIds: v.branchIds })
        : http.post('/staff', v),
  });
  const onSubmit = handleSubmit(async (v) => {
    try {
      await save.mutateAsync(v);
      await props.onSaved(current ? undefined : { name: v.name, password: v.temporaryPassword });
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setError('root', { message: FORBIDDEN_MSG });
      else applyServerErrors(e, setError, { EMAIL_TAKEN: 'email', INVALID_BRANCHES: 'branchIds' });
    }
  });
  const { errors, isSubmitting } = formState;

  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{current ? `Edit ${current.name}` : 'Add staff'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormField id="name" label="Name" error={errors.name?.message}>
            <Input id="name" autoFocus {...register('name')} />
          </FormField>
          {!isEdit && (
            <FormField id="email" label="Email" error={errors.email?.message}>
              <Input id="email" type="email" autoComplete="off" {...register('email')} />
            </FormField>
          )}
          <FormField id="role" label="Role" error={errors.role?.message}>
            <Controller
              control={control}
              name="role"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="role" className="w-full capitalize">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => (
                      <SelectItem key={r} value={r} className="capitalize">
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>
          <FormField
            id="branches"
            label={role === 'cashier' ? 'Branch' : 'Branches'}
            error={errors.branchIds?.message ?? errors.branchIds?.root?.message}
            hint={
              role === 'cashier' ? 'A cashier works at exactly one branch.' : 'A manager can run several.'
            }
          >
            <Controller
              control={control}
              name="branchIds"
              render={({ field }) => (
                <BranchPicker
                  branches={branches}
                  multiple={role !== 'cashier'}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </FormField>
          {!isEdit && (
            <FormField
              id="pw"
              label="Temporary password"
              error={errors.temporaryPassword?.message}
              hint="Shown once after saving. They must change it at first login."
            >
              <div className="flex gap-2">
                <Input id="pw" className="font-mono" autoComplete="off" {...register('temporaryPassword')} />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setValue('temporaryPassword', generateTempPassword(), { shouldValidate: true })
                  }
                >
                  Generate
                </Button>
              </div>
            </FormField>
          )}
          {errors.root && <p className="text-sm text-red-600">{errors.root.message}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={props.onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : current ? 'Save' : 'Add staff'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Only MY branches are offered. Cashier: radio (exactly one). Manager: checkboxes. */
function BranchPicker(props: {
  branches: BranchSummaryDto[];
  multiple: boolean;
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const toggle = (id: string, on: boolean) => {
    if (!props.multiple) return props.onChange([id]);
    props.onChange(on ? [...props.value, id] : props.value.filter((v) => v !== id));
  };
  return (
    <div id="branches" className="grid grid-cols-2 gap-2 rounded-md border p-2">
      {props.branches.map((b) => (
        <label key={b.id} className="flex items-center gap-2 text-sm">
          <input
            type={props.multiple ? 'checkbox' : 'radio'}
            name="branchIds"
            checked={props.value.includes(b.id)}
            disabled={!b.isActive && !props.value.includes(b.id)}
            onChange={(e) => toggle(b.id, e.target.checked)}
          />
          <span className="font-mono">{b.code}</span> {b.name}
          {!b.isActive && <span className="text-xs text-gray-500">(inactive)</span>}
        </label>
      ))}
    </div>
  );
}
