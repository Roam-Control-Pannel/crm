'use client';
import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const result = await signIn('credentials', { username, password, redirect: false });
    if (result?.ok) {
      router.push('/');
      router.refresh();
    } else {
      setError('Incorrect username or password');
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#1a0d12', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Nunito Sans, sans-serif', padding: 16, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: '20%', left: '50%', transform: 'translateX(-50%)', width: 600, height: 600, maxWidth: '100vw', background: 'radial-gradient(circle, rgba(139,26,58,0.25) 0%, transparent 70%)', pointerEvents: 'none' }} />
      <div className="login-card">
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ width: 56, height: 56, background: 'linear-gradient(135deg, #6B1230, #8B1A3A)', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, margin: '0 auto 16px', boxShadow: '0 4px 20px rgba(139,26,58,0.5)' }}>🦁</div>
          <div style={{ fontFamily: 'Nunito, sans-serif', fontWeight: 900, fontSize: 28, color: '#fff', letterSpacing: -1 }}>roam</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.35)', letterSpacing: 3, textTransform: 'uppercase', marginTop: 4 }}>Growth Engine</div>
        </div>
        <form onSubmit={handleLogin} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 32 }}>
          <div style={{ marginBottom: 18 }}>
            <label htmlFor="login-username" style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.5)', marginBottom: 8, letterSpacing: 0.5 }}>Username</label>
            <input id="login-username" name="username" type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="Enter username" required autoComplete="username" autoCapitalize="none" autoCorrect="off"
              style={{ width: '100%', padding: '11px 14px', background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 16, color: '#fff', outline: 'none', fontFamily: 'Nunito Sans, sans-serif', boxSizing: 'border-box' }}/>
          </div>
          <div style={{ marginBottom: 24 }}>
            <label htmlFor="login-password" style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.5)', marginBottom: 8, letterSpacing: 0.5 }}>Password</label>
            <input id="login-password" name="password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter password" required autoComplete="current-password"
              style={{ width: '100%', padding: '11px 14px', background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 16, color: '#fff', outline: 'none', fontFamily: 'Nunito Sans, sans-serif', boxSizing: 'border-box' }}/>
          </div>
          {error && (
            <div style={{ background: 'rgba(139,26,58,0.2)', border: '1px solid rgba(139,26,58,0.4)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#f5c0cc', marginBottom: 18, textAlign: 'center' }}>{error}</div>
          )}
          <button type="submit" disabled={loading}
            style={{ width: '100%', padding: '12px', background: 'linear-gradient(135deg, #6B1230, #8B1A3A)', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, color: '#fff', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1, fontFamily: 'Nunito Sans, sans-serif', boxShadow: '0 4px 14px rgba(139,26,58,0.4)' }}>
            {loading ? 'Signing in…' : 'Sign in to Roam'}
          </button>
        </form>
        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>Roam Growth Engine · Private access only</div>
      </div>
    </div>
  );
}
