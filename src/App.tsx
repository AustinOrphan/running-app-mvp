import { useState, useEffect } from 'react'
import './App.css'

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

function App() {
  const [healthStatus, setHealthStatus] = useState<string>('Checking...')
  const [runs, setRuns] = useState<any[]>([])
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [activeTab, setActiveTab] = useState('runs')
  const [showRunForm, setShowRunForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [runForm, setRunForm] = useState({
    date: new Date().toISOString().split('T')[0],
    distance: '',
    duration: '',
    tag: '',
    notes: ''
  })

  // Toast functions
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now().toString()
    const newToast: Toast = { id, message, type }
    setToasts(prev => [...prev, newToast])
    
    // Auto remove after 4 seconds
    setTimeout(() => {
      removeToast(id)
    }, 4000)
  }

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id))
  }

  useEffect(() => {
    // Check server health
    fetch('/api/health')
      .then(res => res.json())
      .then(data => {
        setHealthStatus('✅ Backend Connected')
        showToast('Connected to server', 'success')
      })
      .catch(() => {
        setHealthStatus('❌ Backend Offline')
        showToast('Failed to connect to server', 'error')
      })

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
    setLoading(true)
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
        showToast('Welcome back! Successfully logged in', 'success')
        fetchRuns(data.token)
      } else {
        const errorData = await response.json().catch(() => ({}))
        showToast(errorData.message || 'Login failed', 'error')
      }
    } catch (error) {
      showToast('Network error. Please try again.', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async () => {
    setLoading(true)
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
        showToast('Account created successfully! Welcome to Running Tracker', 'success')
        fetchRuns(data.token)
      } else {
        const errorData = await response.json().catch(() => ({}))
        showToast(errorData.message || 'Registration failed', 'error')
      }
    } catch (error) {
      showToast('Network error. Please try again.', 'error')
    } finally {
      setLoading(false)
    }
  }

  const logout = () => {
    localStorage.removeItem('authToken')
    setIsLoggedIn(false)
    setRuns([])
    showToast('You have been logged out', 'info')
  }

  const handleRunSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const token = localStorage.getItem('authToken')
    if (!token) return

    setLoading(true)
    const runData = {
      date: new Date(runForm.date).toISOString(),
      distance: Number(runForm.distance),
      duration: Number(runForm.duration) * 60, // Convert minutes to seconds
      tag: runForm.tag || null,
      notes: runForm.notes || null
    }

    try {
      const response = await fetch('/api/runs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(runData)
      })

      if (response.ok) {
        setRunForm({
          date: new Date().toISOString().split('T')[0],
          distance: '',
          duration: '',
          tag: '',
          notes: ''
        })
        setShowRunForm(false)
        showToast(`🏃‍♂️ Run saved! ${runForm.distance}km in ${runForm.duration} minutes`, 'success')
        fetchRuns(token)
      } else {
        const errorData = await response.json().catch(() => ({}))
        showToast(errorData.message || 'Failed to save run', 'error')
      }
    } catch (error) {
      console.error('Failed to create run:', error)
      showToast('Network error. Failed to save run.', 'error')
    } finally {
      setLoading(false)
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
              <button type="submit" disabled={loading}>
                {loading ? '⏳ Logging in...' : 'Login'}
              </button>
              <button type="button" onClick={handleRegister} disabled={loading}>
                {loading ? '⏳ Creating account...' : 'Register'}
              </button>
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

      <nav className="main-nav">
        <button 
          className={`nav-btn ${activeTab === 'runs' ? 'active' : ''}`}
          onClick={() => setActiveTab('runs')}
        >
          📊 Runs
        </button>
        <button 
          className={`nav-btn ${activeTab === 'goals' ? 'active' : ''}`}
          onClick={() => setActiveTab('goals')}
        >
          🎯 Goals
        </button>
        <button 
          className={`nav-btn ${activeTab === 'races' ? 'active' : ''}`}
          onClick={() => setActiveTab('races')}
        >
          🏆 Races
        </button>
        <button 
          className={`nav-btn ${activeTab === 'stats' ? 'active' : ''}`}
          onClick={() => setActiveTab('stats')}
        >
          📈 Stats
        </button>
      </nav>

      <div className="dashboard">
        {activeTab === 'runs' && (
          <div className="runs-section">
            <div className="section-header">
              <h2>Your Runs ({runs.length})</h2>
              <button 
                onClick={() => setShowRunForm(!showRunForm)} 
                className="primary-btn"
              >
                {showRunForm ? 'Cancel' : '+ Add Run'}
              </button>
            </div>

            {showRunForm && (
              <form onSubmit={handleRunSubmit} className="run-form">
                <div className="form-row">
                  <div className="form-group">
                    <label>Date</label>
                    <input
                      type="date"
                      value={runForm.date}
                      onChange={(e) => setRunForm({...runForm, date: e.target.value})}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Distance (km)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={runForm.distance}
                      onChange={(e) => setRunForm({...runForm, distance: e.target.value})}
                      placeholder="5.0"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Duration (minutes)</label>
                    <input
                      type="number"
                      value={runForm.duration}
                      onChange={(e) => setRunForm({...runForm, duration: e.target.value})}
                      placeholder="30"
                      required
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Tag (optional)</label>
                    <select
                      value={runForm.tag}
                      onChange={(e) => setRunForm({...runForm, tag: e.target.value})}
                    >
                      <option value="">Select a tag</option>
                      <option value="Training">Training</option>
                      <option value="Race">Race</option>
                      <option value="Easy">Easy</option>
                      <option value="Long">Long Run</option>
                      <option value="Speed">Speed Work</option>
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label>Notes (optional)</label>
                  <textarea
                    value={runForm.notes}
                    onChange={(e) => setRunForm({...runForm, notes: e.target.value})}
                    placeholder="How did it feel? Route details, weather, etc."
                    rows={3}
                  />
                </div>
                <div className="form-actions">
                  <button type="submit" className="primary-btn" disabled={loading}>
                    {loading ? '⏳ Saving...' : 'Save Run'}
                  </button>
                  <button type="button" onClick={() => setShowRunForm(false)} className="secondary-btn" disabled={loading}>
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {runs.length === 0 ? (
              <p>No runs yet. Add your first run above!</p>
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
        )}

        {activeTab === 'goals' && (
          <div className="section">
            <h2>🎯 Goals</h2>
            <p>Goal tracking coming soon! Set distance targets and track your progress.</p>
          </div>
        )}

        {activeTab === 'races' && (
          <div className="section">
            <h2>🏆 Races</h2>
            <p>Race management coming soon! Track upcoming races and results.</p>
          </div>
        )}

        {activeTab === 'stats' && (
          <div className="section">
            <h2>📈 Statistics</h2>
            <p>Detailed analytics coming soon! View your running trends and insights.</p>
          </div>
        )}
      </div>

      {/* Toast Container */}
      <div className="toast-container">
        {toasts.map(toast => (
          <div 
            key={toast.id} 
            className={`toast toast-${toast.type}`}
            onClick={() => removeToast(toast.id)}
          >
            <span className="toast-icon">
              {toast.type === 'success' && '✅'}
              {toast.type === 'error' && '❌'}
              {toast.type === 'info' && 'ℹ️'}
            </span>
            <span className="toast-message">{toast.message}</span>
            <button className="toast-close" onClick={() => removeToast(toast.id)}>×</button>
          </div>
        ))}
      </div>
    </div>
  )
}

export default App