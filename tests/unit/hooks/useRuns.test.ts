import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useRuns } from '../../../src/hooks/useRuns';
import { Run, RunFormData } from '../../../src/types';

// Mock the formatters
vi.mock('../../../src/utils/formatters', () => ({
  calculatePace: vi.fn((distance: number, duration: number) => duration / distance),
}));

// Mock ApiError class
class MockApiError extends Error {
  status?: number;
  response?: Response;
  data?: unknown;
  
  constructor(message: string, status?: number, response?: Response, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.response = response;
    this.data = data;
  }
}

// Mock the apiFetch utilities
vi.mock('../../../utils/apiFetch', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  ApiError: MockApiError,
}));

// Import the mocked functions
import { apiGet, apiPost, apiPut, apiDelete } from '../../../utils/apiFetch';

const mockRuns: Run[] = [
  {
    id: '1',
    date: '2024-06-15T06:00:00Z',
    distance: 5.2,
    duration: 1860, // 31 minutes
    tag: 'Easy Run',
    notes: 'Morning run in the park',
    userId: 'user-1',
    createdAt: '2024-06-15T06:00:00Z',
    updatedAt: '2024-06-15T06:00:00Z',
  },
  {
    id: '2',
    date: '2024-06-14T06:00:00Z',
    distance: 8.0,
    duration: 2700, // 45 minutes
    tag: 'Long Run',
    notes: 'Weekend long run',
    userId: 'user-1',
    createdAt: '2024-06-14T06:00:00Z',
    updatedAt: '2024-06-14T06:00:00Z',
  },
];

describe('useRuns', () => {
  const mockApiGet = apiGet as any;
  const mockApiPost = apiPost as any;
  const mockApiPut = apiPut as any;
  const mockApiDelete = apiDelete as any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Set up localStorage mock with auth token
    localStorage.setItem('authToken', 'valid-token');

    // Mock console.error to avoid noise in tests
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // Setup default mock responses
    mockApiGet.mockResolvedValue({ data: [] });
    mockApiPost.mockResolvedValue({ data: {} });
    mockApiPut.mockResolvedValue({ data: {} });
    mockApiDelete.mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe('Initial State', () => {
    it('starts with empty runs array and loading false when no token', () => {
      const { result } = renderHook(() => useRuns(null));

      expect(result.current.runs).toEqual([]);
      expect(result.current.loading).toBe(false);
      expect(result.current.saving).toBe(false);
      expect(typeof result.current.fetchRuns).toBe('function');
      expect(typeof result.current.saveRun).toBe('function');
      expect(typeof result.current.deleteRun).toBe('function');
    });

    it('automatically fetches runs when token is provided', async () => {
      mockApiGet.mockResolvedValue({
        data: mockRuns,
      });

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useRuns('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.runs).toEqual(mockRuns);
      expect(mockApiGet).toHaveBeenCalledWith('/api/runs');
    });

    it('does not fetch runs when token is null', () => {
      renderHook(() => useRuns(null));

      expect(mockApiGet).not.toHaveBeenCalled();
    });
  });

  describe('fetchRuns', () => {
    it('successfully fetches and sets runs data', async () => {
      mockApiGet.mockResolvedValue({
        data: mockRuns,
      });

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useRuns('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.runs).toEqual(mockRuns);
      expect(result.current.runs).toHaveLength(2);
    });

    it('handles empty runs response', async () => {
      mockApiGet.mockResolvedValue({
        data: [],
      });

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useRuns('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.runs).toEqual([]);
    });

    it('handles API error responses', async () => {
      const error = new MockApiError('Failed to fetch runs', 401);
      mockApiGet.mockRejectedValue(error);

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useRuns('invalid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.runs).toEqual([]);
      expect(console.error).toHaveBeenCalledWith('Failed to fetch runs:', error);
    });

    it('handles network errors', async () => {
      const error = new Error('Network error');
      mockApiGet.mockRejectedValue(error);

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useRuns('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.runs).toEqual([]);
      expect(console.error).toHaveBeenCalledWith('Failed to fetch runs:', error);
    });

    it('can be called manually to refresh data', async () => {
      // Initial setup
      mockApiGet.mockResolvedValue({
        data: mockRuns,
      });

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useRuns('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Clear the mock to test manual call
      mockApiGet.mockClear();
      mockApiGet.mockResolvedValue({
        data: [
          ...mockRuns,
          {
            id: '3',
            date: '2024-06-13T06:00:00Z',
            distance: 3.0,
            duration: 1200,
            tag: 'Recovery',
            notes: 'Easy recovery run',
            userId: 'user-1',
            createdAt: '2024-06-13T06:00:00Z',
            updatedAt: '2024-06-13T06:00:00Z',
          },
        ],
      });

      await act(async () => {
        await result.current.fetchRuns();
      });

      expect(result.current.runs).toHaveLength(3);
      expect(mockApiGet).toHaveBeenCalledTimes(1);
    });

    it('sets and clears loading state correctly', async () => {
      let resolvePromise: (value: any) => void;
      const mockPromise = new Promise(resolve => {
        resolvePromise = resolve;
      });

      mockApiGet.mockImplementation(() => mockPromise);

      const { result } = renderHook(() => useRuns('valid-token'));

      expect(result.current.loading).toBe(true);

      act(() => {
        resolvePromise({
          data: mockRuns,
        });
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });
  });

  describe('saveRun', () => {
    const validFormData: RunFormData = {
      date: '2024-06-16',
      distance: '6.5',
      duration: '35', // 35 minutes
      tag: 'Tempo Run',
      notes: 'Good tempo effort',
    };

    it('successfully creates new run', async () => {
      const newRun = {
        id: '3',
        date: '2024-06-16T00:00:00.000Z',
        distance: 6.5,
        duration: 2100, // 35 minutes in seconds
        tag: 'Tempo Run',
        notes: 'Good tempo effort',
        userId: 'user-1',
        createdAt: '2024-06-16T06:00:00Z',
        updatedAt: '2024-06-16T06:00:00Z',
      };

      // Mock POST request for creating run
      mockApiPost.mockResolvedValue({
        data: newRun,
      });

      // Mock GET request for refreshing data
      mockApiGet.mockResolvedValue({
        data: [...mockRuns, newRun],
      });

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useRuns('valid-token'));
      });

      const { result } = hookResult!;

      // Wait for initial fetch to complete
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.saveRun(validFormData);
      });

      expect(result.current.saving).toBe(false);
      expect(result.current.runs).toHaveLength(3);

      // Check that POST was called with correct data
      expect(mockApiPost).toHaveBeenCalledWith('/api/runs', {
        date: new Date('2024-06-16').toISOString(),
        distance: 6.5,
        duration: 2100, // 35 minutes * 60 seconds
        tag: 'Tempo Run',
        notes: 'Good tempo effort',
      });
    });

    it('successfully updates existing run', async () => {
      const editingRun = mockRuns[0];
      const updateData: RunFormData = {
        ...validFormData,
        distance: '7.0',
        notes: 'Updated notes',
      };
      const updatedRun = {
        ...editingRun,
        distance: 7.0,
        notes: 'Updated notes',
      };

      mockApiPut.mockResolvedValue({
        data: updatedRun,
      });

      mockApiGet.mockResolvedValue({
        data: [updatedRun, mockRuns[1]],
      });

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useRuns('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.saveRun(updateData, editingRun);
      });

      expect(result.current.saving).toBe(false);
      expect(result.current.runs[0].distance).toBe(7.0);
      expect(result.current.runs[0].notes).toBe('Updated notes');

      // Check that PUT was called with correct data
      expect(mockApiPut).toHaveBeenCalledWith(`/api/runs/${editingRun.id}`, {
        date: new Date('2024-06-16').toISOString(),
        distance: 7.0,
        duration: 2100,
        tag: 'Tempo Run',
        notes: 'Updated notes',
      });
    });

    it('handles form data with empty optional fields', async () => {
      const minimalFormData: RunFormData = {
        date: '2024-06-16',
        distance: '5.0',
        duration: '30',
        tag: '',
        notes: '',
      };

      mockApiPost.mockResolvedValue({
        data: {},
      });

      mockApiGet.mockResolvedValue({
        data: mockRuns,
      });

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useRuns('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.saveRun(minimalFormData);
      });

      expect(mockApiPost).toHaveBeenCalledWith('/api/runs', {
        date: new Date('2024-06-16').toISOString(),
        distance: 5.0,
        duration: 1800,
        tag: null,
        notes: null,
      });
    });

    it('throws error when no token provided', async () => {
      const { result } = renderHook(() => useRuns(null));

      await expect(async () => {
        await act(async () => {
          await result.current.saveRun(validFormData);
        });
      }).rejects.toThrow('No authentication token');
    });

    it('handles API error responses', async () => {
      const error = new MockApiError('Validation error', 400, undefined, {
        message: 'Validation error',
      });
      mockApiPost.mockRejectedValue(error);

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useRuns('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(async () => {
        await act(async () => {
          await result.current.saveRun(validFormData);
        });
      }).rejects.toThrow('Validation error');

      expect(result.current.saving).toBe(false);
    });

    it('handles API error responses without message', async () => {
      const error = new MockApiError('Bad request', 400);
      mockApiPost.mockRejectedValue(error);

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useRuns('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(async () => {
        await act(async () => {
          await result.current.saveRun(validFormData);
        });
      }).rejects.toThrow('Bad request');

      // Test for edit case - set up PUT mock to fail
      const putError = new MockApiError('Bad request', 400);
      mockApiPut.mockRejectedValue(putError);

      await expect(async () => {
        await act(async () => {
          await result.current.saveRun(validFormData, mockRuns[0]);
        });
      }).rejects.toThrow('Bad request');
    });

    it('handles network errors', async () => {
      const error = new Error('Network error');
      mockApiPost.mockRejectedValue(error);

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useRuns('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(async () => {
        await act(async () => {
          await result.current.saveRun(validFormData);
        });
      }).rejects.toThrow('Network error');

      expect(result.current.saving).toBe(false);
    });

    it('sets and clears saving state correctly', async () => {
      let resolvePromise: (value: any) => void;
      const mockPromise = new Promise(resolve => {
        resolvePromise = resolve;
      });

      mockApiPost.mockImplementation(() => mockPromise);

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useRuns('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.saving).toBe(false);

      act(() => {
        result.current.saveRun(validFormData);
      });

      expect(result.current.saving).toBe(true);

      act(() => {
        resolvePromise({
          data: {},
        });
      });

      await waitFor(() => {
        expect(result.current.saving).toBe(false);
      });
    });
  });

  describe('deleteRun', () => {
    it('successfully deletes run', async () => {
      mockApiDelete.mockResolvedValue({
        data: {},
      });

      mockApiGet.mockResolvedValue({
        data: [mockRuns[1]], // Only second run remains
      });

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useRuns('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.deleteRun(mockRuns[0].id);
      });

      expect(result.current.runs).toHaveLength(1);
      expect(result.current.runs[0].id).toBe(mockRuns[1].id);

      expect(mockApiDelete).toHaveBeenCalledWith(`/api/runs/${mockRuns[0].id}`);
    });

    it('throws error when no token provided', async () => {
      const { result } = renderHook(() => useRuns(null));

      await expect(async () => {
        await act(async () => {
          await result.current.deleteRun('run-id');
        });
      }).rejects.toThrow('No authentication token');
    });

    it('handles API error responses', async () => {
      const error = new MockApiError('Not found', 404);
      mockApiDelete.mockRejectedValue(error);

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useRuns('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(async () => {
        await act(async () => {
          await result.current.deleteRun('non-existent-id');
        });
      }).rejects.toThrow('Not found');
    });

    it('handles network errors', async () => {
      const error = new Error('Network error');
      mockApiDelete.mockRejectedValue(error);

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useRuns('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(async () => {
        await act(async () => {
          await result.current.deleteRun('run-id');
        });
      }).rejects.toThrow('Network error');
    });
  });

  describe('Token Changes', () => {
    it('refetches runs when token changes from null to valid', async () => {
      mockApiGet.mockResolvedValue({
        data: mockRuns,
      });

      const { result, rerender } = renderHook(
        (props: { token: string | null }) => useRuns(props.token),
        {
          initialProps: { token: null as string | null },
        }
      );

      expect(result.current.runs).toEqual([]);
      expect(mockApiGet).not.toHaveBeenCalled();

      rerender({ token: 'valid-token' as string | null });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.runs).toEqual(mockRuns);
      expect(mockApiGet).toHaveBeenCalledWith('/api/runs');
    });

    it('refetches runs when token changes to different token', async () => {
      mockApiGet.mockResolvedValue({
        data: mockRuns,
      });

      const { result, rerender } = renderHook(({ token }) => useRuns(token), {
        initialProps: { token: 'token1' },
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const initialCallCount = mockApiGet.mock.calls.length;

      rerender({ token: 'token2' });

      await waitFor(() => {
        expect(mockApiGet.mock.calls.length).toBeGreaterThan(initialCallCount);
      });

      expect(mockApiGet).toHaveBeenLastCalledWith('/api/runs');
    });

    it('does not fetch when token changes to null', () => {
      mockApiGet.mockResolvedValue({
        data: mockRuns,
      });

      const { rerender } = renderHook((props: { token: string | null }) => useRuns(props.token), {
        initialProps: { token: 'valid-token' as string | null },
      });

      const initialCallCount = mockApiGet.mock.calls.length;

      rerender({ token: null as string | null });

      // Should not make additional calls
      expect(mockApiGet.mock.calls.length).toBe(initialCallCount);
    });
  });

  describe('Data Transformations', () => {
    it('converts form data correctly for API', async () => {
      const formData: RunFormData = {
        date: '2024-06-16',
        distance: '10.5',
        duration: '65', // 1 hour 5 minutes
        tag: 'Long Run',
        notes: 'Great weather',
      };

      mockApiPost.mockResolvedValue({
        data: {},
      });

      mockApiGet.mockResolvedValue({
        data: [],
      });

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useRuns('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.saveRun(formData);
      });

      expect(mockApiPost).toHaveBeenCalledWith('/api/runs', {
        date: new Date('2024-06-16').toISOString(),
        distance: 10.5,
        duration: 3900, // 65 minutes * 60 seconds
        tag: 'Long Run',
        notes: 'Great weather',
      });
    });

    it('handles decimal distance values correctly', async () => {
      const formData: RunFormData = {
        date: '2024-06-16',
        distance: '5.123',
        duration: '30.5',
        tag: '',
        notes: '',
      };

      mockApiPost.mockResolvedValue({
        data: {},
      });

      mockApiGet.mockResolvedValue({
        data: [],
      });

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useRuns('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.saveRun(formData);
      });

      expect(mockApiPost).toHaveBeenCalledWith('/api/runs', {
        date: new Date('2024-06-16').toISOString(),
        distance: 5.123,
        duration: 1830, // 30.5 minutes * 60 seconds
        tag: null,
        notes: null,
      });
    });
  });

  describe('Error Logging', () => {
    it('logs errors to console on fetch failure', async () => {
      const error = new Error('Network failure');
      mockApiGet.mockRejectedValue(error);

      await act(async () => {
        renderHook(() => useRuns('valid-token'));
      });

      await waitFor(() => {
        expect(console.error).toHaveBeenCalledWith('Failed to fetch runs:', error);
      });
    });

    it('logs errors to console on save failure', async () => {
      const error = new Error('Save failure');
      mockApiPost.mockRejectedValue(error);

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useRuns('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      try {
        await act(async () => {
          await result.current.saveRun({
            date: '2024-06-16',
            distance: '5.0',
            duration: '30',
            tag: '',
            notes: '',
          });
        });
      } catch (e) {
        // Expected to throw
      }

      expect(console.error).toHaveBeenCalledWith('Failed to save run:', error);
    });

    it('logs errors to console on delete failure', async () => {
      const error = new Error('Delete failure');
      mockApiDelete.mockRejectedValue(error);

      let hookResult: any;

      await act(async () => {
        hookResult = renderHook(() => useRuns('valid-token'));
      });

      const { result } = hookResult!;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      try {
        await act(async () => {
          await result.current.deleteRun('run-id');
        });
      } catch (e) {
        // Expected to throw
      }

      expect(console.error).toHaveBeenCalledWith('Failed to delete run:', error);
    });
  });
});
