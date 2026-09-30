'use client'

import { useState, useActionState } from 'react'
import { signupAction } from '@/app/auth/actions'
import GoogleSignInButton from '@/app/auth/GoogleSignInButton'
import Link from 'next/link'

export default function SignupForm() {
  const [googleError, setGoogleError] = useState<string | null>(null)
  const [state, formAction, isPending] = useActionState(signupAction, null)

  const activeError = googleError || state?.error

  const isAllowlistOrDbError =
    activeError &&
    (activeError.toLowerCase().includes('database error') ||
      activeError.toLowerCase().includes('allowlist') ||
      activeError.toLowerCase().includes('not allowed') ||
      activeError.toLowerCase().includes('denied') ||
      activeError.toLowerCase().includes('unauthorized') ||
      activeError.toLowerCase().includes('violation'))

  return (
    <div className="auth-card">
      <div className="auth-header">
        <div className="brand-badge">
          <span>🔒 VIP Membership Access</span>
        </div>
        <h1 className="auth-title">Create Account</h1>
        <p className="auth-subtitle">Sign up with your approved email address</p>
      </div>

      {activeError && (
        <div className="alert-banner alert-danger" role="alert">
          <span className="alert-icon">🚫</span>
          <div className="alert-content">
            <strong>
              {isAllowlistOrDbError ? 'Allowlist Verification Failed' : 'Registration Error'}
            </strong>
            <p>{activeError}</p>
            {isAllowlistOrDbError && (
              <p style={{ marginTop: '8px', fontSize: '0.82rem', opacity: 0.9 }}>
                Your email is not present in the authorized <code>allowed_emails</code> database.
                Please ensure you enter the exact email used during checkout or contact support.
              </p>
            )}
          </div>
        </div>
      )}

      {state?.success && state?.message && (
        <div className="alert-banner alert-success" role="alert">
          <span className="alert-icon">✅</span>
          <div className="alert-content">
            <strong>Registration Received</strong>
            <p>{state.message}</p>
          </div>
        </div>
      )}

      <GoogleSignInButton
        label="Sign up with Google"
        disabled={isPending}
        onError={(err) => setGoogleError(err)}
      />

      <div className="auth-divider">or register with email</div>

      <form action={formAction} className="auth-form">
        <div className="form-group">
          <label className="form-label" htmlFor="email">
            Approved Email Address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="member@example.com"
            className="form-input"
            disabled={isPending}
          />
          <span className="form-hint">Must match your subscription email in the database</span>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="password">
            Create Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="new-password"
            placeholder="At least 6 characters"
            className="form-input"
            disabled={isPending}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="confirmPassword">
            Confirm Password
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            autoComplete="new-password"
            placeholder="Repeat password"
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
              <span>Verifying Allowlist...</span>
            </>
          ) : (
            <span>Create Account ↗</span>
          )}
        </button>
      </form>

      <div className="auth-footer">
        Already have an account?{' '}
        <Link href="/login" className="auth-link">
          Log in instead
        </Link>
      </div>
    </div>
  )
}
