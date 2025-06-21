import { useState, useEffect } from 'react';

export const useAuth = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Check if user has token
    const token = localStorage.getItem('authToken');
    if (token) {
      setIsLoggedIn(true);
    }
  }, []);

  const login = async (email: string, password: string): Promise<{ success: boolean; token?: string; message?: string }> => {
    setLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      
      if (response.ok) {
        const data = await response.json();
        localStorage.setItem('authToken', data.token);
        setIsLoggedIn(true);
        return { success: true, token: data.token };
      } else {
        const errorData = await response.json().catch(() => ({}));
        return { success: false, message: errorData.message || 'Login failed' };
      }
    } catch (error) {
      return { success: false, message: 'Network error. Please try again.' };
    } finally {
      setLoading(false);
    }
  };

  const register = async (email: string, password: string): Promise<{ success: boolean; token?: string; message?: string }> => {
    setLoading(true);
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      
      if (response.ok) {
        const data = await response.json();
        localStorage.setItem('authToken', data.token);
        setIsLoggedIn(true);
        return { success: true, token: data.token };
      } else {
        const errorData = await response.json().catch(() => ({}));
        return { success: false, message: errorData.message || 'Registration failed' };
      }
    } catch (error) {
      return { success: false, message: 'Network error. Please try again.' };
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('authToken');
    setIsLoggedIn(false);
  };

  const getToken = () => localStorage.getItem('authToken');

  return {
    isLoggedIn,
    loading,
    login,
    register,
    logout,
    getToken
  };
};