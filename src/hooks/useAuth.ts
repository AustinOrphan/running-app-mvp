import { useState, useEffect } from 'react';
import {
  apiPost,
  ApiError,
  setTokens,
  clearTokens,
  getAuthToken,
  authEvents,
} from '../utils/apiFetch';

export const useAuth = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Check if user has access token (or fallback to old authToken)
    const accessToken = getAuthToken();
    const oldToken = localStorage.getItem('authToken');
    
    if (accessToken || oldToken) {
      setIsLoggedIn(true);
      // Migrate old token to new structure if needed
      if (oldToken && !accessToken) {
        localStorage.setItem('accessToken', oldToken);
        localStorage.removeItem('authToken');
      }
    }

    // Listen for authentication events
    const handleAuthFailure = (event: Event) => {
      const customEvent = event as CustomEvent;
      // eslint-disable-next-line no-console -- Intentional auth failure warning for debugging
      console.warn('Authentication failed:', customEvent.detail);
      setIsLoggedIn(false);
      // Token is already cleared by apiFetch
    };

    const handleTokenRefresh = () => {
      setIsLoggedIn(true);
    };

    authEvents.addEventListener('authenticationFailed', handleAuthFailure);
    authEvents.addEventListener('tokenRefreshed', handleTokenRefresh);

    return () => {
      authEvents.removeEventListener('authenticationFailed', handleAuthFailure);
      authEvents.removeEventListener('tokenRefreshed', handleTokenRefresh);
    };
  }, []);

  const login = async (
    email: string,
    password: string
  ): Promise<{ success: boolean; accessToken?: string; message?: string }> => {
    setLoading(true);
    try {
      const response = await apiPost<{
        accessToken: string;
        refreshToken: string;
        user: { id: string; email: string };
      }>(
        '/api/auth/login',
        { email, password },
        { skipAuth: true } // Login doesn't require existing auth
      );

      setTokens(response.data.accessToken, response.data.refreshToken);
      setIsLoggedIn(true);
      return { success: true, accessToken: response.data.accessToken };
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
  ): Promise<{ success: boolean; accessToken?: string; message?: string }> => {
    setLoading(true);
    try {
      const response = await apiPost<{
        accessToken: string;
        refreshToken: string;
        user: { id: string; email: string };
      }>(
        '/api/auth/register',
        { email, password },
        { skipAuth: true } // Registration doesn't require existing auth
      );

      setTokens(response.data.accessToken, response.data.refreshToken);
      setIsLoggedIn(true);
      return { success: true, accessToken: response.data.accessToken };
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
    clearTokens();
    setIsLoggedIn(false);
  };

  const getToken = () => getAuthToken();

  return {
    isLoggedIn,
    loading,
    login,
    register,
    logout,
    getToken,
  };
};
