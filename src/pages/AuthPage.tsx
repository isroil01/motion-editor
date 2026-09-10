/**
 * AuthPage — Modern, Studio-Grade Auth Screen with ZERO Box Shadows.
 * Handles /login, /register, /forgot-password, and /reset-password.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@stores/authStore';
import { api } from '@core/api/client';
import { startSocialAuth } from '@core/auth/startSocialAuth';
import { setSession } from '@core/api/session';
import { Icon } from '@components/Icon/Icon';
import { Logo } from '@components/Logo';
import { cn } from '@utils/cn';
import styles from './AuthPage.module.css';

export type AuthMode = 'login' | 'register' | 'forgot' | 'reset';

export function AuthPage({ mode }: { mode: AuthMode }): JSX.Element {
  const status = useAuthStore((s) => s.status);
  const storeError = useAuthStore((s) => s.error);
  const user = useAuthStore((s) => s.user);
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState('');

  const [localBusy, setLocalBusy] = useState(false);
  const [localError, setLocalError] = useState('');
  const [sent, setSent] = useState(false);

  /**
   * Social sign-in options from the server.
   */
  const [providers, setProviders] = useState<{ id: 'google' | 'github'; label: string }[]>([]);
  useEffect(() => {
    let alive = true;
    api
      .authProviders()
      .then((r) => {
        if (alive) setProviders(r.providers);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const isLogin = mode === 'login';
  const isRegister = mode === 'register';
  const isForgot = mode === 'forgot';
  const isReset = mode === 'reset';
  const resetToken = searchParams.get('token') ?? '';

  const submitting = status === 'loading' || localBusy;
  const error = localError || (isForgot || isReset ? '' : storeError);

  const authedDest = user && !user.emailVerified ? '/verify-email' : from;
  if (status === 'authenticated' && !isReset) return <Navigate to={authedDest} replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError('');

    if (isForgot) {
      setLocalBusy(true);
      try {
        await api.forgotPassword(email);
        setSent(true);
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : 'Unable to process request.');
      } finally {
        setLocalBusy(false);
      }
      return;
    }

    if (isReset) {
      setLocalBusy(true);
      try {
        const result = await api.resetPassword(resetToken, password);
        await setSession(result);
        useAuthStore.setState({ status: 'authenticated', user: result.user, error: null });
        navigate(result.user.emailVerified ? '/dashboard' : '/verify-email', { replace: true });
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : 'Could not reset password.');
      } finally {
        setLocalBusy(false);
      }
      return;
    }

    try {
      if (isLogin) await login(email, password);
      else await register(email, password, name || undefined);
      const u = useAuthStore.getState().user;
      navigate(u && !u.emailVerified ? '/verify-email' : from, { replace: true });
    } catch {
      /* error handled via store */
    }
  };

  const title = isLogin
    ? 'Sign in to Motion'
    : isRegister
      ? 'Create an account'
      : isForgot
        ? 'Reset your password'
        : 'Set new password';

  const subtitle = isLogin
    ? 'Welcome back. Enter your credentials to continue.'
    : isRegister
      ? 'Get started with cloud-accelerated motion graphics.'
      : isForgot
        ? "We'll send a temporary password reset link to your email."
        : 'Enter your new account password below.';

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        {/* Brand header lockup */}
        <div className={styles.brandHeader}>
          <Logo variant="lockup" size={32} />
          <span className={styles.brandBadge}>Studio</span>
        </div>

        {/* Segmented Auth Mode Switcher */}
        {(isLogin || isRegister) && (
          <div className={styles.modeSwitcher} role="tablist" aria-label="Authentication mode">
            <Link
              to="/login"
              role="tab"
              aria-selected={isLogin}
              className={cn(styles.modeTab, isLogin && styles.modeTabActive)}
            >
              Sign In
            </Link>
            <Link
              to="/register"
              role="tab"
              aria-selected={isRegister}
              className={cn(styles.modeTab, isRegister && styles.modeTabActive)}
            >
              Create Account
            </Link>
          </div>
        )}

        <div className={styles.headerText}>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.subtitle}>{subtitle}</p>
        </div>

        {isReset && !resetToken ? (
          <div className={styles.alert}>
            <p role="alert">This link is missing its security token.</p>
            <Link to="/forgot-password" className={styles.link}>
              Request a new link
            </Link>
          </div>
        ) : sent ? (
          <div className={styles.alert}>
            <p role="status">
              If <strong>{email}</strong> exists in our system, a password reset link has been dispatched.
            </p>
            <Link to="/login" className={styles.link}>
              Back to sign in
            </Link>
          </div>
        ) : (
          <form className={styles.form} onSubmit={onSubmit}>
            {/* Social Authentication */}
            {(isLogin || isRegister) && providers.some((p) => p.id === 'google') && (
              <>
                <div className={styles.socialGrid}>
                  <button
                    type="button"
                    className={styles.socialBtn}
                    disabled={submitting}
                    onClick={() => startSocialAuth('google')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.62z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                      />
                    </svg>
                    <span>Continue with Google</span>
                  </button>
                </div>

                <div className={styles.divider}>
                  <span>OR CONTINUE WITH EMAIL</span>
                </div>
              </>
            )}

            {isRegister && (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="name">
                  Full Name
                </label>
                <div className={styles.inputWrapper}>
                  <span className={styles.inputIcon} aria-hidden="true">
                    <Icon name="user" size="sm" />
                  </span>
                  <input
                    id="name"
                    type="text"
                    className={styles.input}
                    autoComplete="name"
                    placeholder="Jane Doe"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
              </div>
            )}

            {!isReset && (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="email">
                  Email Address
                </label>
                <div className={styles.inputWrapper}>
                  <span className={styles.inputIcon} aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect width="20" height="16" x="2" y="4" rx="2" />
                      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                    </svg>
                  </span>
                  <input
                    id="email"
                    type="email"
                    className={styles.input}
                    autoComplete="email"
                    required
                    placeholder="name@domain.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>
            )}

            {!isForgot && (
              <div className={styles.field}>
                <div className={styles.labelRow}>
                  <label className={styles.label} htmlFor="password">
                    {isReset ? 'New Password' : 'Password'}
                  </label>
                  {isLogin && (
                    <Link to="/forgot-password" className={styles.forgotLink}>
                      Forgot password?
                    </Link>
                  )}
                </div>
                <div className={styles.inputWrapper}>
                  <span className={styles.inputIcon} aria-hidden="true">
                    <Icon name="lock" size="sm" />
                  </span>
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    className={styles.input}
                    autoComplete={isLogin ? 'current-password' : 'new-password'}
                    required
                    minLength={isLogin ? undefined : 8}
                    placeholder={isLogin ? '••••••••' : 'At least 8 characters'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    className={styles.passwordToggle}
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <Icon name={showPassword ? 'eye-off' : 'eye'} size="sm" />
                  </button>
                </div>

                {/* Password validation indicators for sign-up */}
                {isRegister && password.length > 0 && (
                  <div className={styles.passwordRules} aria-live="polite">
                    <span className={cn(styles.ruleChip, password.length >= 8 && styles.ruleChipValid)}>
                      <span className={styles.ruleDot} />
                      <span>8+ characters</span>
                    </span>
                    <span
                      className={cn(
                        styles.ruleChip,
                        /[A-Za-z]/.test(password) && /\d/.test(password) && styles.ruleChipValid,
                      )}
                    >
                      <span className={styles.ruleDot} />
                      <span>Letters & numbers</span>
                    </span>
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className={styles.errorAlert} role="alert">
                <Icon name="warning" size="sm" />
                <span>{error}</span>
              </div>
            )}

            <button type="submit" className={styles.primaryBtn} disabled={submitting}>
              {submitting && <span className={styles.spinner} aria-hidden="true" />}
              <span>
                {submitting
                  ? 'Please wait…'
                  : isLogin
                    ? 'Sign In'
                    : isRegister
                      ? 'Create Account'
                      : isForgot
                        ? 'Send Reset Link'
                        : 'Set Password'}
              </span>
            </button>

            {isRegister && (
              <p className={styles.termsNotice}>
                By creating an account, you agree to our Terms of Service and Privacy Policy.
              </p>
            )}

            <div className={styles.footerLink}>
              {isLogin ? (
                <span>
                  Don't have an account? <Link to="/register">Sign up</Link>
                </span>
              ) : isRegister ? (
                <span>
                  Already have an account? <Link to="/login">Sign in</Link>
                </span>
              ) : (
                <span>
                  Remembered your password? <Link to="/login">Sign in</Link>
                </span>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default AuthPage;
