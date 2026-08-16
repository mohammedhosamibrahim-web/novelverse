import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';

export default function ProtectedRoute({ children, adminOnly = false }) {
  const { user, loading } = useAuth();
  const { t } = useI18n();
  if (loading) {
    return <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">{t('common.loading')}</div>;
  }
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== 'super_admin') {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="text-2xl font-bold text-white">{t('protected.adminOnlyTitle')}</h1>
        <p className="mt-2 text-sm text-slate-400">{t('protected.adminOnlyDesc')}</p>
      </div>
    );
  }
  return children;
}
