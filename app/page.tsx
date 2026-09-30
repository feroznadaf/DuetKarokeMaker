import { createClient } from '@/utils/supabase/server'
import { logoutAction } from '@/app/auth/actions'
import { redirect } from 'next/navigation'

export default async function HomePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Fetch access expiry details for banner display
  const { data: allowed } = await supabase
    .from('allowed_emails')
    .select('access_expires_at')
    .ilike('email', user.email || '')
    .maybeSingle()

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
