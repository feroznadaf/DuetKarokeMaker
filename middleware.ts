import { NextResponse, type NextRequest } from 'next/server'
import { createMiddlewareClient } from '@/utils/supabase/middleware'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow public auth routes, expired page, and auth callback without gating
  if (
    pathname === '/login' ||
    pathname === '/signup' ||
    pathname === '/expired' ||
    pathname.startsWith('/auth')
  ) {
    const { response } = createMiddlewareClient(request)
    return response
  }

  // Initialize Supabase middleware client
  const { supabase, response } = createMiddlewareClient(request)

  // 1. Get authenticated user
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  // If no user, redirect to /login
  if (!user || authError) {
    const loginUrl = new URL('/login', request.url)
    return NextResponse.redirect(loginUrl)
  }

  // 2. Fetch user's current_session_token from profiles and access_expires_at from allowed_emails
  const userEmail = user.email || ''
  const [profileResult, allowedResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('current_session_token')
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('allowed_emails')
      .select('access_expires_at')
      .eq('email', userEmail)
      .maybeSingle(),
  ])

  const dbSessionToken = profileResult.data?.current_session_token
  const accessExpiresAt = allowedResult.data?.access_expires_at
  const deviceSessionToken = request.cookies.get('device_session_token')?.value

  // Check 1 (Single Device): If the device_session_token cookie does NOT match the database current_session_token,
  // sign them out via Supabase auth, delete their cookies, and redirect to /login?error=device with a message
  // that they were logged in from another device.
  if (!deviceSessionToken || !dbSessionToken || deviceSessionToken !== dbSessionToken) {
    await supabase.auth.signOut()
    const redirectResponse = NextResponse.redirect(new URL('/login?error=device', request.url))

    // Delete device_session_token cookie
    redirectResponse.cookies.delete('device_session_token')

    // Delete all auth session cookies
    for (const cookie of request.cookies.getAll()) {
      if (cookie.name.startsWith('sb-') || cookie.name === 'device_session_token') {
        redirectResponse.cookies.delete(cookie.name)
      }
    }

    // Set expiration headers for signOut cookies
    response.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie.name, '', {
        path: '/',
        maxAge: 0,
      })
    })

    return redirectResponse
  }

  // Check 2 (Payment Status): If access_expires_at is null, or if the current date/time is greater than access_expires_at,
  // redirect them to /expired.
  if (!accessExpiresAt || new Date() > new Date(accessExpiresAt)) {
    const expiredUrl = new URL('/expired', request.url)
    return NextResponse.redirect(expiredUrl)
  }

  // If they pass both checks, allow the request to proceed.
  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - static assets (svg, png, jpg, jpeg, gif, webp, mp3, wav, ogg, m4a, mp4, webm, ass, css, js)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp3|wav|ogg|m4a|mp4|webm|ass|css|js)$).*)',
  ],
}
