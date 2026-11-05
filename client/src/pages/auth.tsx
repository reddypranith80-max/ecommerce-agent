import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { forgotPasswordSchema, loginSchema, passwordSchema, registerSchema } from '@shop/shared';
import { Alert, Button, Card, Input, useDocumentTitle } from '../components/ui';
import { useSignIn } from '../features/hooks';
import { ApiError, api, errorMessage } from '../services/api';
import { toast } from '../store/local';
import { isAdmin, useSession } from '../store/session';

function AuthShell({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="container-page flex justify-center py-12">
      <Card className="w-full max-w-md p-6 sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-stone-500">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </Card>
    </div>
  );
}

function safeFrom(from: string | null) {
  return from && from.startsWith('/') && !from.startsWith('//') ? from : null;
}

export function LoginPage() {
  useDocumentTitle('Sign in');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const status = useSession((s) => s.status);
  const user = useSession((s) => s.user);
  const signIn = useSignIn();
  const [error, setError] = useState<string | null>(null);
  const form = useForm({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });
  const from = safeFrom(params.get('from'));

  // Same destination as the post-sign-in navigate below, so the two can never disagree.
  if (status === 'authenticated' && !signIn.isPending) return <Navigate to={from ?? (isAdmin(user) ? '/admin' : '/')} replace />;

  const submit = form.handleSubmit((values) => {
    setError(null);
    signIn.mutate(
      { mode: 'login', body: values },
      {
        onSuccess: (r) => {
          toast.success(`Welcome back, ${r.user.name.split(' ')[0]}!`);
          navigate(from ?? (isAdmin(r.user) ? '/admin' : '/'), { replace: true });
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  });

  const fill = (email: string, password: string) => {
    form.setValue('email', email);
    form.setValue('password', password);
  };

  return (
    <AuthShell title="Sign in" subtitle={<>New here? <Link to={`/register${from ? `?from=${encodeURIComponent(from)}` : ''}`} className="font-medium text-brand-700 hover:underline">Create an account</Link></>}>
      <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
        <p className="font-medium text-amber-900">Demo accounts</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => fill('asha@demo.store', 'Shop@1234')}>Customer: Asha</Button>
          <Button size="sm" variant="outline" onClick={() => fill('admin@demo.store', 'Admin@1234')}>Store admin</Button>
        </div>
      </div>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="error">{error}</Alert>}
        <Input label="Email" type="email" autoComplete="email" {...form.register('email')} error={form.formState.errors.email?.message} />
        <Input label="Password" type="password" autoComplete="current-password" {...form.register('password')} error={form.formState.errors.password?.message} />
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm text-brand-700 hover:underline">Forgot password?</Link>
        </div>
        <Button type="submit" size="lg" className="w-full" loading={signIn.isPending}>Sign in</Button>
      </form>
    </AuthShell>
  );
}

export function RegisterPage() {
  useDocumentTitle('Create account');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const signIn = useSignIn();
  const form = useForm({ resolver: zodResolver(registerSchema), defaultValues: { name: '', email: '', password: '' } });
  const from = safeFrom(params.get('from'));

  const submit = form.handleSubmit((values) =>
    signIn.mutate(
      { mode: 'register', body: values },
      {
        onSuccess: () => {
          toast.success('Your account is ready!');
          navigate(from ?? '/', { replace: true });
        },
        onError: (e) => {
          if (e instanceof ApiError && e.code === 'EMAIL_TAKEN') form.setError('email', { message: e.message });
          else if (e instanceof ApiError) for (const [k, m] of Object.entries(e.fieldErrors())) form.setError(k as never, { message: m });
          else toast.error(errorMessage(e));
        },
      },
    ),
  );

  return (
    <AuthShell title="Create your account" subtitle={<>Already registered? <Link to="/login" className="font-medium text-brand-700 hover:underline">Sign in</Link></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Input label="Full name" autoComplete="name" {...form.register('name')} error={form.formState.errors.name?.message} />
        <Input label="Email" type="email" autoComplete="email" {...form.register('email')} error={form.formState.errors.email?.message} />
        <Input label="Password" type="password" autoComplete="new-password" hint="At least 8 characters with a letter and a number." {...form.register('password')} error={form.formState.errors.password?.message} />
        <Button type="submit" size="lg" className="w-full" loading={signIn.isPending}>Create account</Button>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  useDocumentTitle('Forgot password');
  const [sent, setSent] = useState(false);
  const form = useForm({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: '' } });
  const send = useMutation({ mutationFn: (v: { email: string }) => api.post('/auth/forgot-password', v), onSuccess: () => setSent(true), onError: (e) => toast.error(errorMessage(e)) });
  return (
    <AuthShell title="Reset your password" subtitle="We will email you a link to choose a new password.">
      {sent ? (
        <Alert tone="success">
          If an account exists for that email, a reset link is on its way. In this demo, open the <Link to="/demo/inbox" className="font-medium underline">demo inbox</Link> to find it.
        </Alert>
      ) : (
        <form onSubmit={form.handleSubmit((v) => send.mutate(v))} className="space-y-4" noValidate>
          <Input label="Email" type="email" autoComplete="email" {...form.register('email')} error={form.formState.errors.email?.message} />
          <Button type="submit" size="lg" className="w-full" loading={send.isPending}>Send reset link</Button>
        </form>
      )}
    </AuthShell>
  );
}

const resetForm = z.object({ password: passwordSchema, confirm: z.string() }).refine((v) => v.password === v.confirm, { message: 'Passwords do not match.', path: ['confirm'] });

export function ResetPasswordPage() {
  useDocumentTitle('Choose a new password');
  const navigate = useNavigate();
  // The token is in the URL fragment so it never reaches server logs.
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
  const form = useForm({ resolver: zodResolver(resetForm), defaultValues: { password: '', confirm: '' } });
  const reset = useMutation({
    mutationFn: (password: string) => api.post('/auth/reset-password', { token, password }),
    onSuccess: () => {
      toast.success('Password changed. Please sign in.');
      navigate('/login', { replace: true });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!token) {
    return (
      <AuthShell title="Link not valid">
        <Alert tone="error">This reset link is incomplete. <Link to="/forgot-password" className="underline">Request a new one</Link>.</Alert>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Choose a new password" subtitle="You will be signed out everywhere else.">
      <form onSubmit={form.handleSubmit((v) => reset.mutate(v.password))} className="space-y-4" noValidate>
        <Input label="New password" type="password" autoComplete="new-password" {...form.register('password')} error={form.formState.errors.password?.message} />
        <Input label="Confirm password" type="password" autoComplete="new-password" {...form.register('confirm')} error={form.formState.errors.confirm?.message} />
        <Button type="submit" size="lg" className="w-full" loading={reset.isPending}>Save new password</Button>
      </form>
    </AuthShell>
  );
}
