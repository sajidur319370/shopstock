import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { changePasswordSchema } from '@shopstock/shared';
import { http } from '@/api/client';
import { qk } from '@/api/keys';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/FormField';
import { applyServerErrors } from '@/lib/formErrors';
import { AuthCard } from './AuthCard';
import { useMe } from './useMe';

const formSchema = changePasswordSchema
  .extend({ confirmPassword: z.string() })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });
type FormValues = z.infer<typeof formSchema>;

export function ChangePasswordPage() {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const forced = !!me.data?.user.mustChangePassword;

  const change = useMutation({
    mutationFn: ({ currentPassword, newPassword }: FormValues) =>
      http.patch<{ ok: true }>('/me/password', { currentPassword, newPassword }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.me });
      toast.success('Password changed. Your other devices were logged out.');
      navigate('/', { replace: true });
    },
  });

  const { register, handleSubmit, setError, formState } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
  });
  const onSubmit = handleSubmit((v) => change.mutateAsync(v).catch((e) => applyServerErrors(e, setError)));
  const { errors, isSubmitting } = formState;

  return (
    <AuthCard
      title={forced ? 'Choose your password' : 'Change password'}
      description={forced ? 'Welcome! Please choose your own password before you start.' : undefined}
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormField
          id="cur"
          label={forced ? 'Temporary password' : 'Current password'}
          error={errors.currentPassword?.message}
        >
          <Input
            id="cur"
            type="password"
            autoComplete="current-password"
            autoFocus
            {...register('currentPassword')}
          />
        </FormField>
        <FormField
          id="new"
          label="New password"
          error={errors.newPassword?.message}
          hint="8+ characters, a letter and a digit"
        >
          <Input id="new" type="password" autoComplete="new-password" {...register('newPassword')} />
        </FormField>
        <FormField id="confirm" label="Confirm new password" error={errors.confirmPassword?.message}>
          <Input id="confirm" type="password" autoComplete="new-password" {...register('confirmPassword')} />
        </FormField>
        {errors.root && <p className="text-sm text-red-600">{errors.root.message}</p>}
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Save password'}
        </Button>
      </form>
      {!forced && (
        <p className="mt-4 text-center text-sm">
          <Link to="/profile" className="text-gray-500 underline">
            Back to profile
          </Link>
        </p>
      )}
    </AuthCard>
  );
}
