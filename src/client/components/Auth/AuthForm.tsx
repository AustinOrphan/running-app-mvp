import React, { useState } from 'react';
import { Input } from '../UI/Input';
import { Button, ButtonGroup } from '../UI/Button';
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
        <Input
          type='email'
          label='Email'
          placeholder='Enter your email'
          value={email}
          onChange={e => setEmail(e.target.value)}
          autoComplete='email'
          required
          disabled={loading}
        />
        <Input
          type='password'
          label='Password'
          placeholder='Minimum 6 characters'
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete='current-password'
          required
          minLength={6}
          disabled={loading}
          helperText='Password must be at least 6 characters long'
        />
        <ButtonGroup className={styles.authButtons} align='justified'>
          <Button type='submit' variant='primary' loading={loading} disabled={loading} fullWidth>
            {loading ? 'Logging in...' : 'Login'}
          </Button>
          <Button
            type='button'
            variant='secondary'
            onClick={handleRegister}
            loading={loading}
            disabled={loading}
            fullWidth
          >
            {loading ? 'Creating account...' : 'Register'}
          </Button>
        </ButtonGroup>
      </form>
    </div>
  );
};
