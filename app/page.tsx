import { createClient } from '@/utils/supabase/server'
import { logoutAction } from '@/app/auth/actions'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'

export default async function HomePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const userEmail = (user.email || '').trim()

  // 1. Fetch profiles session token and allowed_emails
  const cookieStore = await cookies()
  const deviceSessionToken = cookieStore.get('device_session_token')?.value

  const [profileResult, allowedResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('current_session_token')
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('allowed_emails')
      .select('access_expires_at')
      .ilike('email', userEmail)
      .maybeSingle(),
  ])

  const dbSessionToken = profileResult.data?.current_session_token
  const allowed = allowedResult.data

  // Check 1: Single-device enforcement
  if (!deviceSessionToken || !dbSessionToken || deviceSessionToken !== dbSessionToken) {
    redirect('/login?error=device')
  }

  // Check 2: Allowed emails and subscription status
  if (!allowed || (allowed.access_expires_at && new Date() > new Date(allowed.access_expires_at))) {
    redirect('/expired')
  }

  const expiresDate = allowed?.access_expires_at
    ? new Date(allowed.access_expires_at).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'Active'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* Top Gated Studio Navigation Bar */}
      <header className="protected-app-header">
        <div className="header-brand">
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: 'linear-gradient(135deg, #6366f1, #ec4899)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1rem',
            }}
          >
            🎵
          </div>
          <div>
            <h1 className="header-brand-title">Duet Karaoke Maker</h1>
          </div>
        </div>

        <div className="header-account-group">
          <div className="user-badge" title="Active Single-Device Session">
            <span className="pulse-dot"></span>
            <span>{user.email}</span>
          </div>

          <div
            style={{
              fontSize: '0.82rem',
              color: '#a5b4fc',
              background: 'rgba(99, 102, 241, 0.12)',
              border: '1px solid rgba(99, 102, 241, 0.25)',
              padding: '4px 10px',
              borderRadius: '9999px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>🛡️ Valid until {expiresDate}</span>
          </div>

          <form action={logoutAction}>
            <button type="submit" className="btn-signout" title="Sign out of this device">
              Sign Out
            </button>
          </form>
        </div>
      </header>

      {/* Embedded 5-Section Karaoke Studio */}
      <iframe
        src="/studio.html"
        title="Duet Karaoke Maker Studio"
        className="studio-iframe"
        allow="autoplay"
      />
    </div>
  )
}
