'use server'

import { createClient } from '@/utils/supabase/server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export type AuthState = {
  error?: string
  success?: boolean
  message?: string
}

export async function loginAction(
  prevState: AuthState | null,
  formData: FormData
): Promise<AuthState> {
  const email = (formData.get('email') as string)?.trim()
  const password = formData.get('password') as string

  if (!email || !password) {
    return { error: 'Please enter both email and password.' }
  }

  const supabase = await createClient()

  // 1. Authenticate with Supabase
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error || !data.user) {
    return { error: error?.message || 'Invalid login credentials.' }
  }

  // 1b. Verify that this email is in allowed_emails
  const userEmail = (data.user.email || email).trim()
  const { data: allowed } = await supabase
    .from('allowed_emails')
    .select('access_expires_at')
    .ilike('email', userEmail)
    .maybeSingle()

  if (!allowed) {
    await supabase.auth.signOut()
    return {
      error: `Access Denied: The email "${userEmail}" is not in the allowed emails list. Only authorized members can log in.`,
    }
  }

  if (allowed.access_expires_at && new Date() > new Date(allowed.access_expires_at)) {
    await supabase.auth.signOut()
    return {
      error: `Access Expired: Your pass for "${userEmail}" expired on ${new Date(
        allowed.access_expires_at
      ).toLocaleDateString()}. Please contact support to renew.`,
    }
  }

  // 2. Generate a new random UUID for device session
  const newDeviceSessionToken = crypto.randomUUID()

  // 3. Set device_session_token as a secure, HTTP-only cookie
  const cookieStore = await cookies()
  cookieStore.set('device_session_token', newDeviceSessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  })

  // 4. Immediately update current_session_token in profiles table
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', data.user.id)
    .maybeSingle()

  if (!existingProfile) {
    const { error: insertErr } = await supabase.from('profiles').insert({
      id: data.user.id,
      email: data.user.email ?? email,
      current_session_token: newDeviceSessionToken,
    })
    if (insertErr) {
      console.error('Failed to create profile row:', insertErr.message)
    }
  } else {
    const { error: updateErr } = await supabase
      .from('profiles')
      .update({ current_session_token: newDeviceSessionToken })
      .eq('id', data.user.id)
    if (updateErr) {
      console.error('Failed to update profile session token:', updateErr.message)
    }
  }

  redirect('/')
}

export async function signupAction(
  prevState: AuthState | null,
  formData: FormData
): Promise<AuthState> {
  const email = (formData.get('email') as string)?.trim()
  const password = formData.get('password') as string
  const confirmPassword = formData.get('confirmPassword') as string

  if (!email || !password) {
    return { error: 'Please fill in all required fields.' }
  }

  if (password.length < 6) {
    return { error: 'Password must be at least 6 characters long.' }
  }

  if (confirmPassword !== undefined && password !== confirmPassword) {
    return { error: 'Passwords do not match.' }
  }

  const supabase = await createClient()

  // Pre-check allowlist before registration
  const { data: allowed } = await supabase
    .from('allowed_emails')
    .select('access_expires_at')
    .ilike('email', email)
    .maybeSingle()

  if (!allowed) {
    return {
      error: `Access Denied: The email "${email}" is not registered on the allowlist. Only approved members can create an account.`,
    }
  }

  if (allowed.access_expires_at && new Date() > new Date(allowed.access_expires_at)) {
    return {
      error: `Access Expired: The subscription pass for "${email}" has expired. Please contact support to renew.`,
    }
  }

  // Sign up with Supabase
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  })

  // During signup, if Supabase throws an error (allowlist rejection or other), display error clearly
  if (error) {
    return {
      error: error.message,
    }
  }

  // If user is immediately logged in (e.g. email confirmation disabled in Supabase)
  if (data.session && data.user) {
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
        email: data.user.email ?? email,
        current_session_token: newDeviceSessionToken,
      })
    } else {
      await supabase
        .from('profiles')
        .update({ current_session_token: newDeviceSessionToken })
        .eq('id', data.user.id)
    }

    redirect('/')
  }

  return {
    success: true,
    message:
      'Registration successful! If email confirmation is required, please check your inbox and confirm your email before logging in.',
  }
}

export async function logoutAction() {
  const supabase = await createClient()
  await supabase.auth.signOut()

  const cookieStore = await cookies()
  cookieStore.delete('device_session_token')

  redirect('/login')
}
