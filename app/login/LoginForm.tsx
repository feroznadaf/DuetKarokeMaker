'use client'

import { useState, useActionState } from 'react'
import { loginAction } from '@/app/auth/actions'
import GoogleSignInButton from '@/app/auth/GoogleSignInButton'
import Link from 'next/link'

interface LoginFormProps {
  deviceError?: boolean
  initialError?: string
}

export default function LoginForm({ deviceError, initialError }: LoginFormProps) {
  const [googleError, setGoogleError] = useState<string | null>(null)
  const [state, formAction, isPending] = useActionState(loginAction, null)

  const errorMessage = googleError || state?.error || initialError

  return (
    <div className="auth-card">
      <div className="auth-header">
        <div className="brand-badge">
          <span>🎵 Duet Karaoke Studio</span>
        </div>
        <h1 className="auth-title">Welcome Back</h1>
        <p className="auth-subtitle">Log in to access your gated karaoke workspace</p>
      </div>

      {deviceError && (
        <div className="alert-banner alert-warning" role="alert">
          <span className="alert-icon">⚠️</span>
          <div className="alert-content">
            <strong>Logged Out From Another Device</strong>
            <p>
              Your session was disconnected because this account was logged in from another device.
              Only one active device session is permitted at a time.
            </p>
          </div>
        </div>
      )}

      {errorMessage && !deviceError && (
        <div className="alert-banner alert-danger" role="alert">
          <span className="alert-icon">❌</span>
          <div className="alert-content">
            <strong>Authentication Failed</strong>
            <p>{errorMessage}</p>
          </div>
        </div>
      )}

      <GoogleSignInButton
        label="Continue with Google"
        disabled={isPending}
        onError={(err) => setGoogleError(err)}
      />

      <div className="auth-divider">or continue with email</div>

      <form action={formAction} className="auth-form">
        <div className="form-group">
          <label className="form-label" htmlFor="email">
            Email Address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            className="form-input"
            disabled={isPending}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            placeholder="••••••••"
            className="form-input"
            disabled={isPending}
          />
        </div>

        <button type="submit" className="btn-primary" disabled={isPending}>
          {isPending ? (
            <>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin">
                <circle cx="12" cy="12" r="10" strokeDasharray="30" strokeLinecap="round" />
              </svg>
              <span>Verifying Session...</span>
            </>
          ) : (
            <span>Log In to Studio ↗</span>
          )}
        </button>
      </form>

      <div className="auth-footer">
        Don&apos;t have an account?{' '}
        <Link href="/signup" className="auth-link">
          Sign up here
        </Link>
      </div>
    </div>
  )
}
