import { useState, useEffect } from 'react';
import './App.css';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

function App() {
  const [healthStatus, setHealthStatus] = useState<string>('Checking...');
  const [runs, setRuns] = useState<
    Array<{
      id: string;
      date: string;
      distance: number;
      duration: number;
      tag?: string;
      notes?: string;
      routeGeoJson?: unknown;
    }>
  >([]);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [activeTab, setActiveTab] = useState('runs');
  const [showRunForm, setShowRunForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [runsLoading, setRunsLoading] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
  const [editingRun, setEditingRun] = useState<{
    id: string;
    date: string;
    distance: number;
    duration: number;
    tag?: string;
    notes?: string;
    routeGeoJson?: unknown;
  } | null>(null);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const [swipeHighlight, setSwipeHighlight] = useState(false);
  const [hasSwipedOnce, setHasSwipedOnce] = useState(false);

  const [runForm, setRunForm] = useState({
    date: new Date().toISOString().split('T')[0],
    distance: '',
    duration: '',
    tag: '',
    notes: '',
  });

  // Toast functions
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now().toString();
    const newToast: Toast = { id, message, type };
    setToasts(prev => [...prev, newToast]);

    // Auto remove after 4 seconds
    setTimeout(() => {
      removeToast(id);
    }, 4000);
  };

  const removeToast = (id: string) => {
    // Add removing class to trigger animation
    const toastElement = document.querySelector(`[data-toast-id="${id}"]`);
    if (toastElement) {
      toastElement.classList.add('removing');
      // Wait for animation to complete before removing from state
      setTimeout(() => {
        setToasts(prev => prev.filter(toast => toast.id !== id));
      }, 300); // Match the animation duration
    } else {
      // Fallback if element not found
      setToasts(prev => prev.filter(toast => toast.id !== id));
    }
  };

  // Utility functions
  const calculatePace = (distance: number, durationInSeconds: number) => {
    const paceMinutes = durationInSeconds / 60 / distance;
    const minutes = Math.floor(paceMinutes);
    const seconds = Math.round((paceMinutes - minutes) * 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${mins}m ${secs}s`;
    }
    return `${mins}m ${secs}s`;
  };

  // Form validation
  const validateRunForm = () => {
    const errors: { [key: string]: string } = {};

    if (!runForm.distance || Number(runForm.distance) <= 0) {
      errors.distance = 'Distance must be greater than 0';
    }
    if (!runForm.duration || Number(runForm.duration) <= 0) {
      errors.duration = 'Duration must be greater than 0';
    }
    if (!runForm.date) {
      errors.date = 'Date is required';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const resetForm = () => {
    setRunForm({
      date: new Date().toISOString().split('T')[0],
      distance: '',
      duration: '',
      tag: '',
      notes: '',
    });
    setFormErrors({});
    setEditingRun(null);
    setShowRunForm(false);
  };

  // Touch/swipe handling
  const tabs = ['runs', 'goals', 'races', 'stats'];
  const minSwipeDistance = 50;

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;

    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    const currentTabIndex = tabs.indexOf(activeTab);

    if (isLeftSwipe && currentTabIndex < tabs.length - 1) {
      // Swipe left - go to next tab
      const nextTab = tabs[currentTabIndex + 1];
      setActiveTab(nextTab);
      triggerSwipeHighlight();
      if (!hasSwipedOnce) {
        setHasSwipedOnce(true);
        localStorage.setItem('hasSwipedOnce', 'true');
      }
    }

    if (isRightSwipe && currentTabIndex > 0) {
      // Swipe right - go to previous tab
      const prevTab = tabs[currentTabIndex - 1];
      setActiveTab(prevTab);
      triggerSwipeHighlight();
      if (!hasSwipedOnce) {
        setHasSwipedOnce(true);
        localStorage.setItem('hasSwipedOnce', 'true');
      }
    }
  };

  const triggerSwipeHighlight = () => {
    setSwipeHighlight(true);
    setTimeout(() => {
      setSwipeHighlight(false);
    }, 600);
  };

  useEffect(() => {
    // Check server health
    fetch('/api/health')
      .then(res => res.json())
      .then(_data => {
        setHealthStatus('✅ Backend Connected');
        showToast('Connected to server', 'success');
      })
      .catch(() => {
        setHealthStatus('❌ Backend Offline');
        showToast('Failed to connect to server', 'error');
      });

    // Check if user has token
    const token = localStorage.getItem('authToken');
    if (token) {
      setIsLoggedIn(true);
      fetchRuns(token);
    }

    // Check if user has swiped before
    const hasSwipedBefore = localStorage.getItem('hasSwipedOnce');
    if (hasSwipedBefore === 'true') {
      setHasSwipedOnce(true);
    }
  }, []);

  const fetchRuns = async (token: string) => {
    setRunsLoading(true);
    try {
      const response = await fetch('/api/runs', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (response.ok) {
        const runsData = await response.json();
        setRuns(runsData);
      }
    } catch (_error) {
      // eslint-disable-next-line no-console
      console.error('Failed to fetch runs:', _error);
      showToast('Failed to load runs', 'error');
    } finally {
      setRunsLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (response.ok) {
        const data = await response.json();
        localStorage.setItem('authToken', data.token);
        setIsLoggedIn(true);
        showToast('Welcome back! Successfully logged in', 'success');
        fetchRuns(data.token);
      } else {
        const errorData = await response.json().catch(() => ({}));
        showToast(errorData.message || 'Login failed', 'error');
      }
    } catch {
      showToast('Network error. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (response.ok) {
        const data = await response.json();
        localStorage.setItem('authToken', data.token);
        setIsLoggedIn(true);
        showToast('Account created successfully! Welcome to Running Tracker', 'success');
        fetchRuns(data.token);
      } else {
        const errorData = await response.json().catch(() => ({}));
        showToast(errorData.message || 'Registration failed', 'error');
      }
    } catch {
      showToast('Network error. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('authToken');
    setIsLoggedIn(false);
    setRuns([]);
    showToast('You have been logged out', 'info');
  };

  const handleRunSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateRunForm()) {
      showToast('Please fix the errors below', 'error');
      return;
    }

    const token = localStorage.getItem('authToken');
    if (!token) return;

    setLoading(true);
    const runData = {
      date: new Date(runForm.date).toISOString(),
      distance: Number(runForm.distance),
      duration: Number(runForm.duration) * 60, // Convert minutes to seconds
      tag: runForm.tag || null,
      notes: runForm.notes || null,
    };

    try {
      const url = editingRun ? `/api/runs/${editingRun.id}` : '/api/runs';
      const method = editingRun ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(runData),
      });

      if (response.ok) {
        const pace = calculatePace(Number(runForm.distance), Number(runForm.duration) * 60);
        const action = editingRun ? 'updated' : 'saved';
        showToast(
          `🏃‍♂️ Run ${action}! ${runForm.distance}km in ${runForm.duration}min (${pace}/km)`,
          'success'
        );
        resetForm();
        fetchRuns(token);
      } else {
        const errorData = await response.json().catch(() => ({}));
        showToast(errorData.message || `Failed to ${editingRun ? 'update' : 'save'} run`, 'error');
      }
    } catch (_error) {
      // eslint-disable-next-line no-console
      console.error('Failed to save run:', _error);
      showToast('Network error. Failed to save run.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleEditRun = (run: (typeof runs)[0]) => {
    setEditingRun(run);
    setRunForm({
      date: new Date(run.date).toISOString().split('T')[0],
      distance: run.distance.toString(),
      duration: Math.round(run.duration / 60).toString(),
      tag: run.tag || '',
      notes: run.notes || '',
    });
    setShowRunForm(true);
    setFormErrors({});
  };

  const handleDeleteRun = async (runId: string) => {
    if (!confirm('Are you sure you want to delete this run?')) return;

    const token = localStorage.getItem('authToken');
    if (!token) return;

    try {
      const response = await fetch(`/api/runs/${runId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        showToast('Run deleted successfully', 'success');
        fetchRuns(token);
      } else {
        showToast('Failed to delete run', 'error');
      }
    } catch {
      showToast('Network error. Failed to delete run.', 'error');
    }
  };

  if (!isLoggedIn) {
    return (
      <div className='app'>
        <h1>🏃‍♂️ Running Tracker</h1>
        <div className='status'>{healthStatus}</div>

        <div className='auth-form'>
          <h2>Login or Register</h2>
          <form onSubmit={handleLogin}>
            <input
              type='email'
              placeholder='Email'
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
            <input
              type='password'
              placeholder='Password (min 6 chars)'
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={6}
            />
            <div className='auth-buttons'>
              <button type='submit' disabled={loading}>
                {loading ? '⏳ Logging in...' : 'Login'}
              </button>
              <button type='button' onClick={handleRegister} disabled={loading}>
                {loading ? '⏳ Creating account...' : 'Register'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className='app'>
      <header>
        <h1>🏃‍♂️ Running Tracker</h1>
        <div className='header-actions'>
          <div className='status'>{healthStatus}</div>
          <button onClick={logout} className='logout-btn'>
            Logout
          </button>
        </div>
      </header>

      <nav className='main-nav'>
        <button
          className={`nav-btn ${activeTab === 'runs' ? 'active' : ''} ${activeTab === 'runs' && swipeHighlight ? 'swipe-highlight' : ''}`}
          onClick={() => setActiveTab('runs')}
        >
          📊 Runs
        </button>
        <button
          className={`nav-btn ${activeTab === 'goals' ? 'active' : ''} ${activeTab === 'goals' && swipeHighlight ? 'swipe-highlight' : ''}`}
          onClick={() => setActiveTab('goals')}
        >
          🎯 Goals
        </button>
        <button
          className={`nav-btn ${activeTab === 'races' ? 'active' : ''} ${activeTab === 'races' && swipeHighlight ? 'swipe-highlight' : ''}`}
          onClick={() => setActiveTab('races')}
        >
          🏆 Races
        </button>
        <button
          className={`nav-btn ${activeTab === 'stats' ? 'active' : ''} ${activeTab === 'stats' && swipeHighlight ? 'swipe-highlight' : ''}`}
          onClick={() => setActiveTab('stats')}
        >
          📈 Stats
        </button>
      </nav>

      {!hasSwipedOnce && (
        <div className='swipe-hint'>
          <span className='swipe-text'>👈 Swipe to navigate 👉</span>
        </div>
      )}

      <div className='dashboard'>
        <div
          className='tab-content'
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {activeTab === 'runs' && (
            <div className='runs-section tab-panel' key='runs'>
              <div className='section-header'>
                <h2>Your Runs ({runs.length})</h2>
                <button
                  onClick={() => {
                    if (showRunForm) {
                      resetForm();
                    } else {
                      setShowRunForm(true);
                    }
                  }}
                  className='primary-btn'
                  disabled={loading}
                >
                  {showRunForm ? 'Cancel' : '+ Add Run'}
                </button>
              </div>

              {showRunForm && (
                <form onSubmit={handleRunSubmit} className='run-form'>
                  <h3>{editingRun ? 'Edit Run' : 'Add New Run'}</h3>
                  <div className='form-row'>
                    <div className='form-group'>
                      <label>Date</label>
                      <input
                        type='date'
                        value={runForm.date}
                        onChange={e => {
                          setRunForm({ ...runForm, date: e.target.value });
                          if (formErrors.date) setFormErrors({ ...formErrors, date: '' });
                        }}
                        className={formErrors.date ? 'error' : ''}
                      />
                      {formErrors.date && <span className='error-text'>{formErrors.date}</span>}
                    </div>
                    <div className='form-group'>
                      <label>Distance (km)</label>
                      <input
                        type='number'
                        step='0.1'
                        value={runForm.distance}
                        onChange={e => {
                          setRunForm({ ...runForm, distance: e.target.value });
                          if (formErrors.distance) setFormErrors({ ...formErrors, distance: '' });
                        }}
                        placeholder='5.0'
                        className={formErrors.distance ? 'error' : ''}
                      />
                      {formErrors.distance && (
                        <span className='error-text'>{formErrors.distance}</span>
                      )}
                    </div>
                    <div className='form-group'>
                      <label>Duration (minutes)</label>
                      <input
                        type='number'
                        value={runForm.duration}
                        onChange={e => {
                          setRunForm({ ...runForm, duration: e.target.value });
                          if (formErrors.duration) setFormErrors({ ...formErrors, duration: '' });
                        }}
                        placeholder='30'
                        className={formErrors.duration ? 'error' : ''}
                      />
                      {formErrors.duration && (
                        <span className='error-text'>{formErrors.duration}</span>
                      )}
                    </div>
                  </div>
                  <div className='form-row'>
                    <div className='form-group'>
                      <label>Tag (optional)</label>
                      <select
                        value={runForm.tag}
                        onChange={e => setRunForm({ ...runForm, tag: e.target.value })}
                      >
                        <option value=''>Select a tag</option>
                        <option value='Training'>Training</option>
                        <option value='Race'>Race</option>
                        <option value='Easy'>Easy</option>
                        <option value='Long'>Long Run</option>
                        <option value='Speed'>Speed Work</option>
                      </select>
                    </div>
                  </div>
                  <div className='form-group'>
                    <label>Notes (optional)</label>
                    <textarea
                      value={runForm.notes}
                      onChange={e => setRunForm({ ...runForm, notes: e.target.value })}
                      placeholder='How did it feel? Route details, weather, etc.'
                      rows={3}
                    />
                  </div>
                  <div className='form-actions'>
                    <button type='submit' className='primary-btn' disabled={loading}>
                      {loading ? '⏳ Saving...' : editingRun ? 'Update Run' : 'Save Run'}
                    </button>
                    <button
                      type='button'
                      onClick={resetForm}
                      className='secondary-btn'
                      disabled={loading}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              {runsLoading ? (
                <div className='runs-grid'>
                  {[1, 2, 3, 4, 5].map(i => (
                    <div key={i} className='run-card skeleton'>
                      <div className='skeleton-line' style={{ width: '60%', height: '20px' }}></div>
                      <div
                        className='skeleton-line'
                        style={{ width: '80%', height: '16px', marginTop: '10px' }}
                      ></div>
                      <div
                        className='skeleton-line'
                        style={{ width: '40%', height: '14px', marginTop: '8px' }}
                      ></div>
                    </div>
                  ))}
                </div>
              ) : runs.length === 0 ? (
                <div className='empty-state'>
                  <div className='empty-icon'>🏃‍♂️</div>
                  <h3>No runs yet!</h3>
                  <p>Start your running journey by adding your first run above.</p>
                </div>
              ) : (
                <div className='runs-grid'>
                  {runs.map(run => (
                    <div key={run.id} className='run-card'>
                      <div className='run-header'>
                        <div className='run-date'>
                          {new Date(run.date).toLocaleDateString('en-US', {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </div>
                        <div className='run-actions'>
                          <button
                            onClick={() => handleEditRun(run)}
                            className='icon-btn edit-btn'
                            title='Edit run'
                          >
                            ✏️
                          </button>
                          <button
                            onClick={() => handleDeleteRun(run.id)}
                            className='icon-btn delete-btn'
                            title='Delete run'
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                      <div className='run-stats'>
                        <div className='stat'>
                          <span className='stat-value'>{run.distance}km</span>
                          <span className='stat-label'>Distance</span>
                        </div>
                        <div className='stat'>
                          <span className='stat-value'>{formatDuration(run.duration)}</span>
                          <span className='stat-label'>Duration</span>
                        </div>
                        <div className='stat'>
                          <span className='stat-value'>
                            {calculatePace(run.distance, run.duration)}
                          </span>
                          <span className='stat-label'>Pace/km</span>
                        </div>
                      </div>
                      {run.tag && (
                        <div className='run-tag'>
                          <span className='tag'>{run.tag}</span>
                        </div>
                      )}
                      {run.notes && <div className='run-notes'>{run.notes}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'goals' && (
            <div className='section tab-panel' key='goals'>
              <div className='feature-preview'>
                <div className='feature-icon'>🎯</div>
                <h2>Goals</h2>
                <p>Set distance targets and track your progress towards achieving them.</p>
                <div className='coming-soon-badge'>Coming Soon</div>
              </div>
            </div>
          )}

          {activeTab === 'races' && (
            <div className='section tab-panel' key='races'>
              <div className='feature-preview'>
                <div className='feature-icon'>🏆</div>
                <h2>Races</h2>
                <p>Track upcoming races, set target times, and record your results.</p>
                <div className='coming-soon-badge'>Coming Soon</div>
              </div>
            </div>
          )}

          {activeTab === 'stats' && (
            <div className='section tab-panel' key='stats'>
              <div className='feature-preview'>
                <div className='feature-icon'>📈</div>
                <h2>Statistics</h2>
                <p>View detailed analytics, running trends, and insights about your progress.</p>
                <div className='coming-soon-badge'>Coming Soon</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Toast Container */}
      <div className='toast-container'>
        {toasts.map(toast => (
          <div
            key={toast.id}
            data-toast-id={toast.id}
            className={`toast toast-${toast.type}`}
            onClick={() => removeToast(toast.id)}
          >
            <span className='toast-icon'>
              {toast.type === 'success' && '✅'}
              {toast.type === 'error' && '❌'}
              {toast.type === 'info' && 'ℹ️'}
            </span>
            <span className='toast-message'>{toast.message}</span>
            <button className='toast-close' onClick={() => removeToast(toast.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
