export function authErrorMessage(error: unknown, fallback = '登录暂时不可用，请稍后重试。'): string {
  if (!error) return fallback
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code).toLowerCase() : ''
  const message = typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message).toLowerCase()
    : error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  if (code === 'otp_expired' || message.includes('expired')) return '验证码已过期，请重新获取后再试。'
  if (code === 'invalid_otp' || message.includes('invalid') && message.includes('otp')) return '验证码不正确，请检查后重试。'
  if (message.includes('rate limit') || message.includes('too many')) return '请求次数过多，请稍后重试。'
  if (message.includes('network') || message.includes('fetch')) return '网络连接失败，请检查网络后重试。'
  return fallback
}

export function authRequestMessage(error: unknown): string {
  if (!error) return '登录暂时不可用，请稍后重试。'
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code).toLowerCase() : ''
  const message = typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message).toLowerCase()
    : error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 0
  if (status >= 500) return authErrorMessage(error, '登录暂时不可用，请稍后重试。')
  const membershipCode = ['signup_disabled', 'user_not_found', 'email_not_found'].includes(code)
  const membershipMessage = /\b(?:user|email) (?:not found|does not exist|was not found)\b/.test(message)
    || /signups? (?:are )?not allowed|signups? disabled|signup is disabled/.test(message)
  return authErrorMessage(error, membershipCode || membershipMessage ? '如果该邮箱已受邀，邮件中会有登录链接或验证码。' : '登录暂时不可用，请稍后重试。')
}
