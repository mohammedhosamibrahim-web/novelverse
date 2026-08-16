import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';

export default function Register() {
  const { register } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const { isFirstAccount } = await register(username, email, password);
      if (isFirstAccount) setNotice(t('reg.firstAdminNotice'));
      setTimeout(() => navigate('/'), 1200);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-6 text-center text-2xl font-black text-white">{t('reg.title')}</h1>
      <form onSubmit={submit} className="space-y-4 rounded-2xl border border-surface-border bg-surface-card p-6">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">{t('reg.username')}</label>
          <input required minLength={3} value={username} onChange={(e) => setUsername(e.target.value)} className="input-field" placeholder="reader123" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">{t('login.email')}</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="input-field" placeholder="you@example.com" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">{t('login.password')}</label>
          <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="input-field" placeholder="8+ characters" />
        </div>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        {notice && <p className="rounded-lg bg-emerald-500/10 p-2 text-sm text-emerald-400">{notice}</p>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? t('reg.creating') : t('reg.create')}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-400">
        {t('reg.haveAccount')}{' '}
        <Link to="/login" className="text-accent-soft hover:underline">
          {t('reg.signIn')}
        </Link>
      </p>
    </div>
  );
}
