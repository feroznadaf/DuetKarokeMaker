import { createClient } from '@/utils/supabase/server'
import { logoutAction } from '@/app/auth/actions'
import Link from 'next/link'

export default async function ExpiredPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let userEmail = user?.email
  let expiresAtFormatted: string | null = null

  if (userEmail) {
    const { data: allowed } = await supabase
      .from('allowed_emails')
      .select('access_expires_at')
      .eq('email', userEmail)
      .maybeSingle()

    if (allowed?.access_expires_at) {
      const expDate = new Date(allowed.access_expires_at)
      expiresAtFormatted = expDate.toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    }
  }

  return (
    <div className="auth-page-wrapper">
      <div className="auth-card" style={{ maxWidth: '540px' }}>
        <div className="auth-header">
          <div
            className="brand-badge"
            style={{
              background: 'rgba(239, 68, 68, 0.12)',
              borderColor: 'rgba(239, 68, 68, 0.3)',
              color: '#fca5a5',
            }}
          >
            <span>⏳ Access Status: Inactive / Expired</span>
          </div>
          <h1 className="auth-title">Access Expired or Unpaid</h1>
          <p className="auth-subtitle">
            Your studio license is currently inactive or requires payment renewal.
          </p>
        </div>

        {userEmail && (
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.6)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 16px',
              marginBottom: '20px',
              fontSize: '0.88rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            <div style={{ color: 'var(--text-muted)' }}>Logged in account:</div>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)', wordBreak: 'break-all' }}>
              {userEmail}
            </div>
            {expiresAtFormatted ? (
              <div style={{ color: '#f87171', fontSize: '0.8rem', marginTop: '4px' }}>
                Access expired on: {expiresAtFormatted}
              </div>
            ) : (
              <div style={{ color: '#fbbf24', fontSize: '0.8rem', marginTop: '4px' }}>
                No active subscription found for this email address.
              </div>
            )}
          </div>
        )}

        <div style={{ marginBottom: '24px' }}>
          <h3
            style={{
              fontSize: '0.98rem',
              fontWeight: 600,
              color: 'var(--text-primary)',
              marginBottom: '12px',
            }}
          >
            How to Renew or Restore Access:
          </h3>

          <div className="info-step-card">
            <div className="step-badge">1</div>
            <div className="step-details">
              <h4>Contact Billing Support</h4>
              <p>
                Reach out to our licensing team with your registered email (<code>{userEmail || 'your email'}</code>) to renew your access pass.
              </p>
            </div>
          </div>

          <div className="info-step-card">
            <div className="step-badge">2</div>
            <div className="step-details">
              <h4>Provide Order or Invoice ID</h4>
              <p>
                Include your payment receipt or PayPal/Stripe transaction reference for fast activation.
              </p>
            </div>
          </div>

          <div className="info-step-card">
            <div className="step-badge">3</div>
            <div className="step-details">
              <h4>Instant Reactivation</h4>
              <p>
                Once approved, your access expiration date in the database will be extended automatically.
              </p>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <a
            href={`mailto:support@duetkaraoke.com?subject=Access%20Renewal%20Request%20for%20${encodeURIComponent(
              userEmail || ''
            )}&body=Hello%20Support%2C%0A%0AMy%20access%20to%20Duet%20Karaoke%20Maker%20has%20expired%20or%20is%20pending%20payment.%0AAccount%20Email%3A%20${encodeURIComponent(
              userEmail || ''
            )}%0A%0APlease%20let%20me%20know%20how%20to%20complete%20renewal.%0A%0AThank%20you!`}
            className="btn-primary"
            style={{ textDecoration: 'none' }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect width="20" height="16" x="2" y="4" rx="2" />
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
            <span>Email Support to Renew ↗</span>
          </a>

          <Link href="/" className="btn-secondary">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 21h5v-5" />
            </svg>
            <span>Refresh &amp; Check Access Status</span>
          </Link>

          <form action={logoutAction} style={{ marginTop: '6px' }}>
            <button
              type="submit"
              className="btn-secondary"
              style={{
                borderColor: 'rgba(239, 68, 68, 0.25)',
                color: '#f87171',
                background: 'rgba(239, 68, 68, 0.05)',
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span>Sign Out / Switch Account</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
