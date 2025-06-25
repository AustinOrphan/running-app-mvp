import React, { useState } from 'react';

interface AuthFormProps {
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (email: string, password: string) => Promise<void>;
  loading: boolean;
}

export const AuthForm: React.FC<AuthFormProps> = ({ onLogin, onRegister, loading }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    await onLogin(email, password);
  };

  const handleRegister = async () => {
    await onRegister(email, password);
  };

  return (
    <div className='auth-form'>
      <h2>Login or Register</h2>
      <form onSubmit={handleLogin}>
        <input
          type='email'
          placeholder='Email'
          value={email}
          onChange={e => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <input
          type='password'
          placeholder='Password (min 6 chars)'
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete="current-password"
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
  );
};
