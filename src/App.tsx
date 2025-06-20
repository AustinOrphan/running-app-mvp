import { useState, useEffect } from 'react'
import './App.css'

function App() {
  const [healthStatus, setHealthStatus] = useState<string>('Checking...')
  const [runs, setRuns] = useState<any[]>([])
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  useEffect(() => {
    // Check server health
    fetch('/api/health')
      .then(res => res.json())
      .then(data => setHealthStatus('✅ Backend Connected'))
      .catch(() => setHealthStatus('❌ Backend Offline'))

    // Check if user has token
    const token = localStorage.getItem('authToken')
    if (token) {
      setIsLoggedIn(true)
      fetchRuns(token)
    }
  }, [])

  const fetchRuns = async (token: string) => {
    try {
      const response = await fetch('/api/runs', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      if (response.ok) {
        const runsData = await response.json()
        setRuns(runsData)
      }
    } catch (error) {
      console.error('Failed to fetch runs:', error)
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
      
      if (response.ok) {
        const data = await response.json()
        localStorage.setItem('authToken', data.token)
        setIsLoggedIn(true)
        fetchRuns(data.token)
      } else {
        alert('Login failed')
      }
    } catch (error) {
      alert('Login error')
    }
  }

  const handleRegister = async () => {
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
      
      if (response.ok) {
        const data = await response.json()
        localStorage.setItem('authToken', data.token)
        setIsLoggedIn(true)
        fetchRuns(data.token)
      } else {
        alert('Registration failed')
      }
    } catch (error) {
      alert('Registration error')
    }
  }

  const logout = () => {
    localStorage.removeItem('authToken')
    setIsLoggedIn(false)
    setRuns([])
  }

  const createSampleRun = async () => {
    const token = localStorage.getItem('authToken')
    if (!token) return

    const sampleRun = {
      date: new Date().toISOString(),
      distance: 5.0,
      duration: 1800, // 30 minutes
      tag: 'Training',
      notes: 'Sample run from the app'
    }

    try {
      const response = await fetch('/api/runs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(sampleRun)
      })

      if (response.ok) {
        fetchRuns(token) // Refresh the list
      }
    } catch (error) {
      console.error('Failed to create run:', error)
    }
  }

  if (!isLoggedIn) {
    return (
      <div className="app">
        <h1>🏃‍♂️ Running Tracker</h1>
        <div className="status">{healthStatus}</div>
        
        <div className="auth-form">
          <h2>Login or Register</h2>
          <form onSubmit={handleLogin}>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input
              type="password"
              placeholder="Password (min 6 chars)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
            <div className="auth-buttons">
              <button type="submit">Login</button>
              <button type="button" onClick={handleRegister}>Register</button>
            </div>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <header>
        <h1>🏃‍♂️ Running Tracker</h1>
        <div className="header-actions">
          <div className="status">{healthStatus}</div>
          <button onClick={logout} className="logout-btn">Logout</button>
        </div>
      </header>

      <div className="dashboard">
        <div className="actions">
          <button onClick={createSampleRun} className="primary-btn">
            Add Sample Run
          </button>
        </div>

        <div className="runs-section">
          <h2>Your Runs ({runs.length})</h2>
          {runs.length === 0 ? (
            <p>No runs yet. Create your first run!</p>
          ) : (
            <div className="runs-grid">
              {runs.map((run) => (
                <div key={run.id} className="run-card">
                  <div className="run-date">
                    {new Date(run.date).toLocaleDateString()}
                  </div>
                  <div className="run-details">
                    <span>{run.distance}km</span>
                    <span>{Math.floor(run.duration / 60)}min</span>
                    {run.tag && <span className="tag">{run.tag}</span>}
                  </div>
                  {run.notes && <div className="run-notes">{run.notes}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default App