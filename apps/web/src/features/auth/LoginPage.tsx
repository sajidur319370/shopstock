import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useSearchParams } from 'react-router';
import { loginSchema, type LoginInput } from '@shopstock/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/FormField';
import { applyServerErrors } from '@/lib/formErrors';
import { AuthCard } from './AuthCard';
import { safeReturnTo, useLogin } from './useAuthActions';

export function LoginPage() {
  const [params] = useSearchParams();
  const login = useLogin(safeReturnTo(params.get('returnTo')));
  const { register, handleSubmit, setError, formState } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  });
  const onSubmit = handleSubmit((v) => login.mutateAsync(v).catch((e) => applyServerErrors(e, setError)));

  return (
    <AuthCard title="Log in to ShopStock">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormField id="email" label="Email" error={formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="username" autoFocus {...register('email')} />
        </FormField>
        <FormField id="password" label="Password" error={formState.errors.password?.message}>
          <Input id="password" type="password" autoComplete="current-password" {...register('password')} />
        </FormField>
        {formState.errors.root && <p className="text-sm text-red-600">{formState.errors.root.message}</p>}
        <Button type="submit" className="w-full" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? 'Logging in…' : 'Log in'}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-gray-500">
        Forgot your password? Ask your manager or the owner to reset it.
      </p>
    </AuthCard>
  );
}
