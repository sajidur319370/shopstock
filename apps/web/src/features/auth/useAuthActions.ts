import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import type { AuthResponse, LoginInput, MeResponse, SetupInput } from '@shopstock/shared';
import { http, setAccessToken } from '@/api/client';
import { qk } from '@/api/keys';

/** Only same-site relative paths, to prevent open redirects. */
export const safeReturnTo = (v: string | null) => (v && v.startsWith('/') && !v.startsWith('//') ? v : '/');

function useFinishLogin() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return async ({ accessToken }: AuthResponse, returnTo: string) => {
    setAccessToken(accessToken);
    const me = await http.get<MeResponse>('/me');
    qc.setQueryData(qk.me, me);
    navigate(me.user.mustChangePassword ? '/change-password' : returnTo, { replace: true });
  };
}

export function useLogin(returnTo: string) {
  const finish = useFinishLogin();
  return useMutation({
    mutationFn: (v: LoginInput) => http.post<AuthResponse>('/auth/login', v),
    onSuccess: (res) => finish(res, returnTo),
  });
}

export function useSetup() {
  const qc = useQueryClient();
  const finish = useFinishLogin();
  return useMutation({
    mutationFn: (v: SetupInput) => http.post<AuthResponse>('/setup', v),
    onSuccess: async (res) => {
      qc.setQueryData(qk.setupStatus, { needsSetup: false });
      await finish(res, '/');
    },
    onError: (err) => {
      // Someone else finished setup first: stop showing the wizard.
      if ((err as { code?: string }).code === 'ALREADY_SET_UP') {
        qc.setQueryData(qk.setupStatus, { needsSetup: false });
      }
    },
  });
}

export function useLogout(all = false) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => http.post<void>(all ? '/auth/logout-all' : '/auth/logout'),
    onSettled: () => {
      setAccessToken(null);
      qc.clear(); // drop every cached query of the previous user
      qc.setQueryData(qk.me, null);
      navigate('/login', { replace: true });
    },
  });
}
