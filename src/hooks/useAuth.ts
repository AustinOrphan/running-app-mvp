import { useState, useEffect } from 'react';
import { apiPost, ApiError } from '../../utils/apiFetch';

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

  const login = async (
    email: string,
    password: string
  ): Promise<{ success: boolean; token?: string; message?: string }> => {
    setLoading(true);
    try {
      const response = await apiPost<{ token: string; user: { id: string; email: string } }>(
        '/api/auth/login',
        { email, password },
        { skipAuth: true } // Login doesn't require existing auth
      );

      localStorage.setItem('authToken', response.data.token);
      setIsLoggedIn(true);
      return { success: true, token: response.data.token };
    } catch (error) {
      const apiError = error as ApiError;
      return {
        success: false,
        message:
          apiError.data &&
          typeof apiError.data === 'object' &&
          'message' in apiError.data &&
          typeof apiError.data.message === 'string'
            ? apiError.data.message
            : apiError.message || 'Login failed',
      };
    } finally {
      setLoading(false);
    }
  };

  const register = async (
    email: string,
    password: string
  ): Promise<{ success: boolean; token?: string; message?: string }> => {
    setLoading(true);
    try {
      const response = await apiPost<{ token: string; user: { id: string; email: string } }>(
        '/api/auth/register',
        { email, password },
        { skipAuth: true } // Registration doesn't require existing auth
      );

      localStorage.setItem('authToken', response.data.token);
      setIsLoggedIn(true);
      return { success: true, token: response.data.token };
    } catch (error) {
      const apiError = error as ApiError;
      return {
        success: false,
        message:
          apiError.data &&
          typeof apiError.data === 'object' &&
          'message' in apiError.data &&
          typeof apiError.data.message === 'string'
            ? apiError.data.message
            : apiError.message || 'Registration failed',
      };
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
    getToken,
  };
};
