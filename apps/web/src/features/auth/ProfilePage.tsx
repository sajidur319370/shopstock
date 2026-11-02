import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { updateMeSchema, type MeResponse, type UserDto } from '@shopstock/shared';
import type { z } from 'zod';
import { http } from '@/api/client';
import { qk } from '@/api/keys';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/FormField';
import { applyServerErrors } from '@/lib/formErrors';
import { AuthCard } from './AuthCard';
import { useLogout } from './useAuthActions';
import { useMe } from './useMe';

type FormValues = z.infer<typeof updateMeSchema>;

export function ProfilePage() {
  const me = useMe();
  const qc = useQueryClient();
  const logout = useLogout();
  const logoutAll = useLogout(true);

  const save = useMutation({
    mutationFn: (v: FormValues) => http.patch<{ user: UserDto }>('/me', v),
    onSuccess: ({ user }) => {
      qc.setQueryData<MeResponse | null>(qk.me, (old) => (old ? { ...old, user } : old));
      toast.success('Profile saved');
    },
  });

  const { register, handleSubmit, setError, formState } = useForm<FormValues>({
    resolver: zodResolver(updateMeSchema),
    values: { name: me.data?.user.name ?? '' },
  });
  const onSubmit = handleSubmit((v) => save.mutateAsync(v).catch((e) => applyServerErrors(e, setError)));
  const user = me.data?.user;

  return (
    <AuthCard title="Your profile" description={user ? `${user.email} · ${user.role}` : undefined}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormField id="name" label="Name" error={formState.errors.name?.message}>
          <Input id="name" autoComplete="name" {...register('name')} />
        </FormField>
        {formState.errors.root && <p className="text-sm text-red-600">{formState.errors.root.message}</p>}
        <Button type="submit" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? 'Saving…' : 'Save'}
        </Button>
      </form>
      <div className="mt-6 flex flex-wrap gap-2 border-t pt-4">
        <Button variant="outline" asChild>
          <Link to="/change-password">Change password</Link>
        </Button>
        <Button variant="outline" onClick={() => logout.mutate()} disabled={logout.isPending}>
          Log out
        </Button>
        <Button variant="ghost" onClick={() => logoutAll.mutate()} disabled={logoutAll.isPending}>
          Log out of all devices
        </Button>
      </div>
    </AuthCard>
  );
}
