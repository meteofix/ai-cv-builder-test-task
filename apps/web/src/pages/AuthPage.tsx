import { zodResolver } from '@hookform/resolvers/zod';
import { credentialsSchema, LIMITS, type Credentials } from '@cv/shared';
import { useId } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import type { z } from 'zod';
import { useMe, useSignIn } from '../api/auth';
import { ApiError, errorMessage } from '../api/errors';
import { Spinner } from '../components/Icon';

type FormValues = z.input<typeof credentialsSchema>;

const COPY = {
  login: {
    title: 'Log in',
    submit: 'Log in',
    switchText: 'No account yet?',
    switchLink: 'Sign up',
    switchTo: '/signup',
    autocomplete: 'current-password',
  },
  signup: {
    title: 'Create an account',
    submit: 'Sign up',
    switchText: 'Already have an account?',
    switchLink: 'Log in',
    switchTo: '/login',
    autocomplete: 'new-password',
  },
} as const;

const EMAIL_MESSAGE = 'Enter a valid email address.';
const PASSWORD_MESSAGE = `Use ${LIMITS.minPasswordChars}–${LIMITS.maxPasswordChars} characters.`;

/** Where to go after signing in: the page the guard turned away, if any. */
function useReturnPath(): string {
  const { state } = useLocation() as { state: { from?: unknown } | null };
  const from = state?.from;
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : '/';
}

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const copy = COPY[mode];
  const me = useMe();
  const navigate = useNavigate();
  const returnPath = useReturnPath();
  const signIn = useSignIn(mode);
  const ids = { email: useId(), password: useId() };
  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors },
  } = useForm<FormValues, unknown, Credentials>({
    resolver: zodResolver(credentialsSchema),
    defaultValues: { email: '', password: '' },
  });

  if (me.isPending) {
    return (
      <p className="save-status" role="status">
        <Spinner />
        Loading…
      </p>
    );
  }
  if (me.data) return <Navigate to={returnPath} replace />;

  const onSubmit = (credentials: Credentials) => {
    signIn.mutate(credentials, {
      onSuccess: () => void navigate(returnPath, { replace: true }),
      // Keep the typing: the field that needs fixing gets the focus and the person presses Enter again.
      onError: (error) => {
        if (error instanceof ApiError && error.code === 'INVALID_CREDENTIALS') setFocus('password');
        if (error instanceof ApiError && error.code === 'EMAIL_TAKEN') setFocus('email');
      },
    });
  };

  return (
    <main className="auth">
      <form
        className="auth__card"
        aria-labelledby="auth-title"
        noValidate
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
      >
        <h1 className="auth__title" id="auth-title">
          {copy.title}
        </h1>
        <div className="field">
          <label className="field__label" htmlFor={ids.email}>
            Email
          </label>
          <input
            id={ids.email}
            className="input"
            type="email"
            autoComplete="email"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? `${ids.email}-error` : undefined}
            {...register('email')}
          />
          {errors.email ? (
            <span className="field__error" id={`${ids.email}-error`}>
              {EMAIL_MESSAGE}
            </span>
          ) : null}
        </div>
        <div className="field">
          <label className="field__label" htmlFor={ids.password}>
            Password
          </label>
          <input
            id={ids.password}
            className="input"
            type="password"
            autoComplete={copy.autocomplete}
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={errors.password ? `${ids.password}-error` : undefined}
            {...register('password')}
          />
          {errors.password ? (
            <span className="field__error" id={`${ids.password}-error`}>
              {PASSWORD_MESSAGE}
            </span>
          ) : null}
        </div>
        {signIn.isError ? (
          <p className="auth__error" role="alert">
            {errorMessage(signIn.error)}
          </p>
        ) : null}
        <button type="submit" className="btn btn--primary" disabled={signIn.isPending}>
          {signIn.isPending ? <Spinner /> : null}
          {copy.submit}
        </button>
        <p className="auth__switch">
          {copy.switchText} <Link to={copy.switchTo}>{copy.switchLink}</Link>
        </p>
      </form>
    </main>
  );
}
