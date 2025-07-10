import React, { useState } from 'react';
import styles from '../../styles/components/AuthForm.module.css';

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
    <div className={styles.authForm}>
      <h2 className={styles.title}>Login or Register</h2>
      <form onSubmit={handleLogin}>
        <input
          className={styles.input}
          type='email'
          placeholder='Email'
          value={email}
          onChange={e => setEmail(e.target.value)}
          autoComplete='email'
          required
        />
        <input
          className={styles.input}
          type='password'
          placeholder='Password (min 6 chars)'
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete='current-password'
          required
          minLength={6}
        />
        <div className={styles.authButtons}>
          <button className={styles.button} type='submit' disabled={loading}>
            {loading ? '⏳ Logging in...' : 'Login'}
          </button>
          <button
            className={styles.button}
            type='button'
            onClick={handleRegister}
            disabled={loading}
          >
            {loading ? '⏳ Creating account...' : 'Register'}
          </button>
        </div>
      </form>
    </div>
  );
};
