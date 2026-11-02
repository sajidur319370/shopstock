import { Route, Routes } from 'react-router';
import { RequireAuth, RequirePasswordOk, RequireSetupDone } from '@/features/auth/gates';
import { SetupPage } from '@/features/setup/SetupPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { ChangePasswordPage } from '@/features/auth/ChangePasswordPage';
import { ProfilePage } from '@/features/auth/ProfilePage';
import { NotFoundPage } from '@/components/NotFoundPage';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/setup" element={<SetupPage />} />
      <Route element={<RequireSetupDone />}>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route path="/change-password" element={<ChangePasswordPage />} />
          <Route element={<RequirePasswordOk />}>
            <Route path="/" element={<p className="p-8">The app shell comes on Day 6 👋</p>} />
            <Route path="/profile" element={<ProfilePage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
