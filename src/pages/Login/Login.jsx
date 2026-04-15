import { useState } from 'react'
import { checkLogin } from '../../lib/localDb.js'
import './Login.css'

function Login({ onLogin }) {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    setTimeout(() => {
      const user = checkLogin(email, password)
      if (user) {
        onLogin(user)
      } else {
        setError('E-posta veya şifre hatalı.')
        setLoading(false)
      }
    }, 300)
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <div className="login-logo__icon">☕</div>
          <h1 className="login-logo__name">San Lucas</h1>
          <p className="login-logo__sub">Cafe Yönetim Sistemi</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="login-field">
            <label className="login-label">E-posta</label>
            <input
              className="login-input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="ornek@email.com"
              autoComplete="email"
              required
            />
          </div>

          <div className="login-field">
            <label className="login-label">Şifre</label>
            <input
              className="login-input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>

          {error && <p className="login-error">{error}</p>}

          <button className="login-btn" type="submit" disabled={loading}>
            {loading ? 'Giriş yapılıyor…' : 'Giriş Yap'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default Login
