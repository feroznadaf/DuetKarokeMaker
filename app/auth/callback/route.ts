import { createClient } from '@/utils/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'
  const oauthError = searchParams.get('error_description') || searchParams.get('error')

  if (oauthError) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(oauthError)}`)
  }

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error && data.user) {
      const userEmail = (data.user.email || '').trim()

      // 1. Verify that this email is registered in allowed_emails
      const { data: allowed } = await supabase
        .from('allowed_emails')
        .select('access_expires_at')
        .ilike('email', userEmail)
        .maybeSingle()

      if (!allowed) {
        await supabase.auth.signOut()
        return NextResponse.redirect(
          `${origin}/login?error=${encodeURIComponent(
            `Access Denied: The Google account "${userEmail}" is not in the allowed emails list.`
          )}`
        )
      }

      // 2. Check if access has expired
      if (allowed.access_expires_at && new Date() > new Date(allowed.access_expires_at)) {
        await supabase.auth.signOut()
        return NextResponse.redirect(
          `${origin}/login?error=${encodeURIComponent(
            `Access Expired: Your pass for "${userEmail}" expired on ${new Date(
              allowed.access_expires_at
            ).toLocaleDateString()}. Please contact support to renew.`
          )}`
        )
      }

      // 3. Authorized: set single-device session token
      const newDeviceSessionToken = crypto.randomUUID()
      const cookieStore = await cookies()
      cookieStore.set('device_session_token', newDeviceSessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
      })

      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', data.user.id)
        .maybeSingle()

      if (!existingProfile) {
        await supabase.from('profiles').insert({
          id: data.user.id,
          email: data.user.email,
          current_session_token: newDeviceSessionToken,
        })
      } else {
        await supabase
          .from('profiles')
          .update({ current_session_token: newDeviceSessionToken })
          .eq('id', data.user.id)
      }

      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`)
}
