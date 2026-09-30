import LoginForm from './LoginForm'

interface LoginPageProps {
  searchParams: Promise<{
    error?: string
  }>
}

export default async function LoginPage(props: LoginPageProps) {
  const searchParams = await props.searchParams
  const isDeviceError = searchParams?.error === 'device'
  let initialError: string | undefined = undefined

  if (searchParams?.error === 'auth_failed') {
    initialError = 'Authentication verification failed. Please try again.'
  } else if (searchParams?.error && !isDeviceError) {
    try {
      initialError = decodeURIComponent(searchParams.error)
    } catch {
      initialError = searchParams.error
    }
  }

  return (
    <div className="auth-page-wrapper">
      <LoginForm deviceError={isDeviceError} initialError={initialError} />
    </div>
  )
}
