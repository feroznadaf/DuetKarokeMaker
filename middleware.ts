import { NextResponse, type NextRequest } from 'next/server'
import { createMiddlewareClient } from '@/utils/supabase/middleware'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // 1. Allow public auth routes, expired page, and auth callback without gating
  if (
    pathname === '/login' ||
    pathname === '/signup' ||
    pathname === '/expired' ||
    pathname.startsWith('/auth')
  ) {
    try {
      const { response } = createMiddlewareClient(request)
      return response
    } catch {
      return NextResponse.next()
    }
  }

  try {
    // 2. Initialize Supabase middleware client
    const { supabase, response } = createMiddlewareClient(request)

    // 3. Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    // If no user, redirect to /login
    if (!user || authError) {
      const loginUrl = new URL('/login', request.url)
      return NextResponse.redirect(loginUrl)
    }

    // 4. Fetch user's current_session_token from profiles and access_expires_at from allowed_emails
    const userEmail = (user.email || '').trim()
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
    const accessExpiresAt = allowedResult.data?.access_expires_at
    const deviceSessionToken = request.cookies.get('device_session_token')?.value

    // Check 1 (Single Device): If the device_session_token cookie does NOT match the database current_session_token
    if (!deviceSessionToken || !dbSessionToken || deviceSessionToken !== dbSessionToken) {
      try {
        await supabase.auth.signOut()
      } catch {}

      const redirectResponse = NextResponse.redirect(new URL('/login?error=device', request.url))
      redirectResponse.cookies.delete('device_session_token')

      for (const cookie of request.cookies.getAll()) {
        if (cookie.name.startsWith('sb-') || cookie.name === 'device_session_token') {
          redirectResponse.cookies.delete(cookie.name)
        }
      }

      return redirectResponse
    }

    // Check 2 (Payment/Allowlist Status): If access_expires_at is null, or expired
    if (!accessExpiresAt || new Date() > new Date(accessExpiresAt)) {
      const expiredUrl = new URL('/expired', request.url)
      return NextResponse.redirect(expiredUrl)
    }

    return response
  } catch (err) {
    console.error('[Middleware Error]', err)
    // Fail safe to login page instead of throwing 500 error
    return NextResponse.redirect(new URL('/login', request.url))
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - static assets (.svg, .png, .jpg, .jpeg, .gif, .webp, .mp3, .wav, .ogg, .m4a, .mp4, .webm, .ass, .css, .js, .html, .txt)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp3|wav|ogg|m4a|mp4|webm|ass|css|js|html|txt)$).*)',
  ],
}
