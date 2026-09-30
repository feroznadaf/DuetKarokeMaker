'use client'

import { useState } from 'react'
import { createClient } from '@/utils/supabase/client'

interface GoogleSignInButtonProps {
  label?: string
  disabled?: boolean
  onError?: (error: string) => void
}

export default function GoogleSignInButton({
  label = 'Continue with Google',
  disabled = false,
  onError,
}: GoogleSignInButtonProps) {
  const [loading, setLoading] = useState(false)

  const handleGoogleSignIn = async () => {
    try {
      setLoading(true)
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      })

      if (error) {
        setLoading(false)
        onError?.(error.message)
      }
    } catch (err: any) {
      setLoading(false)
      onError?.(err?.message || 'Failed to initiate Google Sign-In')
    }
  }

  return (
    <button
      type="button"
      onClick={handleGoogleSignIn}
      disabled={disabled || loading}
      className="btn-google"
      title="Sign in with Google"
    >
      {loading ? (
        <>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#1f2937"
            strokeWidth="2.5"
            className="animate-spin"
          >
            <circle cx="12" cy="12" r="10" strokeDasharray="30" strokeLinecap="round" />
          </svg>
          <span>Connecting to Google...</span>
        </>
      ) : (
        <>
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.66v3.04h3.88c2.28-2.09 3.66-5.17 3.66-9.14z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.04c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.13C3.27 21.43 7.34 24 12 24z"
            />
            <path
              fill="#FBBC05"
              d="M5.28 14.28c-.25-.72-.38-1.49-.38-2.28s.13-1.56.38-2.28V6.59H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.41l4.03-3.13z"
            />
            <path
              fill="#EA4335"
              d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.27 2.57 1.25 6.59l4.03 3.13c.95-2.83 3.6-4.97 6.72-4.97z"
            />
          </svg>
          <span>{label}</span>
        </>
      )}
    </button>
  )
}
