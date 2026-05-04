'use client';
import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Lock, User, ArrowRight, AlertCircle } from 'lucide-react';

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

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '11px 14px 11px 40px',
    background: 'rgba(255,255,255,0.06)',
    border: '1.5px solid rgba(255,255,255,0.1)',
    borderRadius: 10, fontSize: 15, color: '#fff', outline: 'none',
    fontFamily: 'inherit', boxSizing: 'border-box', transition: 'border-color 0.15s',
  };

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--maroon-900)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-ui)', padding: 16, overflow: 'hidden',
    }}>
      {/* Glow */}
      <div style={{
        position: 'absolute', top: '15%', left: '50%',
        transform: 'translateX(-50%)', width: 700, height: 700,
        background: 'radial-gradient(circle, rgba(208,48,80,0.15) 0%, transparent 70%)',
        pointerEvents: 'none',
      }}/>

      <div style={{ width: '100%', maxWidth: 380, position: 'relative', zIndex: 1 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{
            width: 68, height: 68,
            borderRadius: 18,
            overflow: 'hidden',
            margin: '0 auto 16px',
            boxShadow: '0 8px 32px rgba(208,48,80,0.4)',
            border: '2px solid rgba(255,255,255,0.1)',
          }}>
            <img
              src="/logo-lionFav-icon.png"
              width={68} height={68}
              alt="Roam"
              style={{ display: 'block', objectFit: 'cover' }}
            />
          </div>
          <div style={{
            fontFamily: 'var(--font-display)', fontSize: 32,
            color: '#fff', letterSpacing: -0.5, lineHeight: 1,
          }}>roam</div>
          <div style={{
            fontSize: 11, fontWeight: 600,
            color: 'rgba(255,255,255,0.3)',
            letterSpacing: '0.2em', textTransform: 'uppercase', marginTop: 6,
          }}>Growth Engine</div>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 20, padding: '28px 28px 24px',
          backdropFilter: 'blur(12px)',
        }}>
          <div style={{ marginBottom: 16 }}>
            <label style={{
              display: 'block', fontSize: 11, fontWeight: 700,
              color: 'rgba(255,255,255,0.4)', marginBottom: 8,
              letterSpacing: '0.1em', textTransform: 'uppercase',
            }}>Username</label>
            <div style={{ position: 'relative' }}>
              <User size={15} style={{
                position: 'absolute', left: 13, top: '50%',
                transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.3)',
              }}/>
              <input
                type="text" value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Enter username" required
                autoComplete="username" autoCapitalize="none" autoCorrect="off"
                style={inputStyle}
              />
            </div>
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{
              display: 'block', fontSize: 11, fontWeight: 700,
              color: 'rgba(255,255,255,0.4)', marginBottom: 8,
              letterSpacing: '0.1em', textTransform: 'uppercase',
            }}>Password</label>
            <div style={{ position: 'relative' }}>
              <Lock size={15} style={{
                position: 'absolute', left: 13, top: '50%',
                transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.3)',
              }}/>
              <input
                type="password" value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter password" required
                autoComplete="current-password"
                style={inputStyle}
              />
            </div>
          </div>

          {error && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: 'rgba(208,48,80,0.15)',
              border: '1px solid rgba(208,48,80,0.3)',
              borderRadius: 10, padding: '10px 14px',
              fontSize: 13, color: '#f5c0cc', marginBottom: 18,
            }}>
              <AlertCircle size={14} style={{ flexShrink: 0 }}/>
              {error}
            </div>
          )}

          <button
            type="submit" disabled={loading}
            style={{
              width: '100%', padding: '12px 16px',
              background: loading ? 'rgba(112,32,64,0.5)' : 'linear-gradient(135deg, var(--maroon-800), var(--maroon-600))',
              border: 'none', borderRadius: 10,
              fontSize: 14, fontWeight: 700, color: '#fff',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              boxShadow: loading ? 'none' : '0 4px 20px rgba(208,48,80,0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'all 0.15s',
            }}
          >
            {loading ? 'Signing in…' : <>Sign in to Roam <ArrowRight size={15}/></>}
          </button>
        </form>

        <div style={{
          textAlign: 'center', marginTop: 20,
          fontSize: 11, color: 'rgba(255,255,255,0.18)',
          letterSpacing: '0.05em',
        }}>Roam Growth Engine · Private access only</div>
      </div>
    </div>
  );
}
