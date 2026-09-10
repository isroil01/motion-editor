import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthPage } from '../AuthPage';
import { useAuthStore } from '@stores/authStore';

function renderAuthPage(mode: 'login' | 'register' | 'forgot' | 'reset', initialEntries = ['/login']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AuthPage mode={mode} />
    </MemoryRouter>,
  );
}

describe('AuthPage UI & UX', () => {
  beforeEach(() => {
    useAuthStore.setState({
      status: 'idle',
      user: null,
      error: null,
    });
  });

  it('renders login page with segmented mode tabs, email and password fields', () => {
    renderAuthPage('login');
    expect(screen.getByRole('heading', { name: 'Sign in to Motion' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Sign In' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Create Account' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByLabelText('Email Address')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
  });

  it('renders register page with Name field and password rules', () => {
    renderAuthPage('register', ['/register']);
    expect(screen.getByRole('heading', { name: 'Create an account' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Create Account' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Full Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Email Address')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Account' })).toBeInTheDocument();
  });

  it('toggles password visibility with eye button', () => {
    renderAuthPage('login');
    const pwdInput = screen.getByLabelText('Password') as HTMLInputElement;
    expect(pwdInput.type).toBe('password');

    const toggleBtn = screen.getByRole('button', { name: /Show password/i });
    fireEvent.click(toggleBtn);
    expect(pwdInput.type).toBe('text');

    const hideBtn = screen.getByRole('button', { name: /Hide password/i });
    fireEvent.click(hideBtn);
    expect(pwdInput.type).toBe('password');
  });

  it('shows password strength rules dynamically as user types on register', () => {
    renderAuthPage('register', ['/register']);
    const pwdInput = screen.getByLabelText('Password') as HTMLInputElement;

    fireEvent.change(pwdInput, { target: { value: 'short' } });
    expect(screen.getByText('8+ characters')).toBeInTheDocument();

    fireEvent.change(pwdInput, { target: { value: 'Secret123!' } });
    expect(screen.getByText('8+ characters')).toBeInTheDocument();
    expect(screen.getByText('Letters & numbers')).toBeInTheDocument();
  });

  it('displays error alert when store reports an error', () => {
    useAuthStore.setState({ error: 'Invalid credentials provided.' });
    renderAuthPage('login');
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid credentials provided.');
  });
});
