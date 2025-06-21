import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useRuns } from '../../../src/hooks/useRuns';
import { Run, RunFormData } from '../../../src/types';

// Mock the formatters
vi.mock('../../../src/utils/formatters', () => ({
  calculatePace: vi.fn((distance: number, duration: number) => duration / distance)
}));

// Mock fetch
const mockFetch = vi.fn();

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
    updatedAt: '2024-06-15T06:00:00Z'
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
    updatedAt: '2024-06-14T06:00:00Z'
  }
];

describe('useRuns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
    
    // Mock console.error to avoid noise in tests
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockRuns)
      });

      const { result } = renderHook(() => useRuns('valid-token'));

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.runs).toEqual(mockRuns);
      expect(mockFetch).toHaveBeenCalledWith('/api/runs', {
        headers: {
          'Authorization': 'Bearer valid-token'
        }
      });
    });

    it('does not fetch runs when token is null', () => {
      renderHook(() => useRuns(null));

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('fetchRuns', () => {
    it('successfully fetches and sets runs data', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockRuns)
      });

      const { result } = renderHook(() => useRuns('valid-token'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.runs).toEqual(mockRuns);
      expect(result.current.runs).toHaveLength(2);
    });

    it('handles empty runs response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([])
      });

      const { result } = renderHook(() => useRuns('valid-token'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.runs).toEqual([]);
    });

    it('handles API error responses', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401
      });

      const { result } = renderHook(() => useRuns('invalid-token'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.runs).toEqual([]);
      expect(console.error).toHaveBeenCalledWith('Failed to fetch runs:', expect.any(Error));
    });

    it('handles network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useRuns('valid-token'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.runs).toEqual([]);
      expect(console.error).toHaveBeenCalledWith('Failed to fetch runs:', expect.any(Error));
    });

    it('can be called manually to refresh data', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockRuns)
      });

      const { result } = renderHook(() => useRuns('valid-token'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Clear the mock to test manual call
      mockFetch.mockClear();
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([...mockRuns, {
          id: '3',
          date: '2024-06-13T06:00:00Z',
          distance: 3.0,
          duration: 1200,
          tag: 'Recovery',
          notes: 'Easy recovery run',
          userId: 'user-1',
          createdAt: '2024-06-13T06:00:00Z',
          updatedAt: '2024-06-13T06:00:00Z'
        }])
      });

      await act(async () => {
        await result.current.fetchRuns();
      });

      expect(result.current.runs).toHaveLength(3);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('sets and clears loading state correctly', async () => {
      let resolvePromise: (value: any) => void;
      const mockPromise = new Promise(resolve => {
        resolvePromise = resolve;
      });

      mockFetch.mockImplementation(() => mockPromise);

      const { result } = renderHook(() => useRuns('valid-token'));

      expect(result.current.loading).toBe(true);

      act(() => {
        resolvePromise({
          ok: true,
          json: vi.fn().mockResolvedValue(mockRuns)
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
      notes: 'Good tempo effort'
    };

    it('successfully creates new run', async () => {
      // Mock POST request for creating run
      mockFetch
        .mockResolvedValueOnce({ // saveRun POST request
          ok: true,
          json: vi.fn().mockResolvedValue({
            id: '3',
            ...validFormData,
            distance: 6.5,
            duration: 2100, // 35 minutes in seconds
            userId: 'user-1'
          })
        })
        .mockResolvedValueOnce({ // fetchRuns GET request after save
          ok: true,
          json: vi.fn().mockResolvedValue([...mockRuns, {
            id: '3',
            date: '2024-06-16T00:00:00.000Z',
            distance: 6.5,
            duration: 2100,
            tag: 'Tempo Run',
            notes: 'Good tempo effort',
            userId: 'user-1',
            createdAt: '2024-06-16T06:00:00Z',
            updatedAt: '2024-06-16T06:00:00Z'
          }])
        });

      const { result } = renderHook(() => useRuns('valid-token'));

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
      expect(mockFetch).toHaveBeenCalledWith('/api/runs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer valid-token'
        },
        body: JSON.stringify({
          date: new Date('2024-06-16').toISOString(),
          distance: 6.5,
          duration: 2100, // 35 minutes * 60 seconds
          tag: 'Tempo Run',
          notes: 'Good tempo effort'
        })
      });
    });

    it('successfully updates existing run', async () => {
      const editingRun = mockRuns[0];
      const updateData: RunFormData = {
        ...validFormData,
        distance: '7.0',
        notes: 'Updated notes'
      };

      mockFetch
        .mockResolvedValueOnce({ // saveRun PUT request
          ok: true,
          json: vi.fn().mockResolvedValue({
            ...editingRun,
            distance: 7.0,
            notes: 'Updated notes'
          })
        })
        .mockResolvedValueOnce({ // fetchRuns GET request after update
          ok: true,
          json: vi.fn().mockResolvedValue([
            {
              ...editingRun,
              distance: 7.0,
              notes: 'Updated notes'
            },
            mockRuns[1]
          ])
        });

      const { result } = renderHook(() => useRuns('valid-token'));

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
      expect(mockFetch).toHaveBeenCalledWith(`/api/runs/${editingRun.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer valid-token'
        },
        body: JSON.stringify({
          date: new Date('2024-06-16').toISOString(),
          distance: 7.0,
          duration: 2100,
          tag: 'Tempo Run',
          notes: 'Updated notes'
        })
      });
    });

    it('handles form data with empty optional fields', async () => {
      const minimalFormData: RunFormData = {
        date: '2024-06-16',
        distance: '5.0',
        duration: '30',
        tag: '',
        notes: ''
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({})
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue(mockRuns)
        });

      const { result } = renderHook(() => useRuns('valid-token'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.saveRun(minimalFormData);
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/runs', expect.objectContaining({
        body: JSON.stringify({
          date: new Date('2024-06-16').toISOString(),
          distance: 5.0,
          duration: 1800,
          tag: null,
          notes: null
        })
      }));
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
      mockFetch.mockResolvedValue({
        ok: false,
        json: vi.fn().mockResolvedValue({
          message: 'Validation error'
        })
      });

      const { result } = renderHook(() => useRuns('valid-token'));

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
      mockFetch.mockResolvedValue({
        ok: false,
        json: vi.fn().mockResolvedValue({})
      });

      const { result } = renderHook(() => useRuns('valid-token'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(async () => {
        await act(async () => {
          await result.current.saveRun(validFormData);
        });
      }).rejects.toThrow('Failed to save run');

      // Test for edit case
      await expect(async () => {
        await act(async () => {
          await result.current.saveRun(validFormData, mockRuns[0]);
        });
      }).rejects.toThrow('Failed to update run');
    });

    it('handles malformed JSON response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: vi.fn().mockRejectedValue(new Error('Invalid JSON'))
      });

      const { result } = renderHook(() => useRuns('valid-token'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(async () => {
        await act(async () => {
          await result.current.saveRun(validFormData);
        });
      }).rejects.toThrow('Failed to save run');
    });

    it('handles network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useRuns('valid-token'));

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

      mockFetch.mockImplementation(() => mockPromise);

      const { result } = renderHook(() => useRuns('valid-token'));

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
          ok: true,
          json: vi.fn().mockResolvedValue({})
        });
      });

      await waitFor(() => {
        expect(result.current.saving).toBe(false);
      });
    });
  });

  describe('deleteRun', () => {
    it('successfully deletes run', async () => {
      mockFetch
        .mockResolvedValueOnce({ // deleteRun DELETE request
          ok: true
        })
        .mockResolvedValueOnce({ // fetchRuns GET request after delete
          ok: true,
          json: vi.fn().mockResolvedValue([mockRuns[1]]) // Only second run remains
        });

      const { result } = renderHook(() => useRuns('valid-token'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.deleteRun(mockRuns[0].id);
      });

      expect(result.current.runs).toHaveLength(1);
      expect(result.current.runs[0].id).toBe(mockRuns[1].id);

      expect(mockFetch).toHaveBeenCalledWith(`/api/runs/${mockRuns[0].id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': 'Bearer valid-token'
        }
      });
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
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404
      });

      const { result } = renderHook(() => useRuns('valid-token'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(async () => {
        await act(async () => {
          await result.current.deleteRun('non-existent-id');
        });
      }).rejects.toThrow('Failed to delete run');
    });

    it('handles network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useRuns('valid-token'));

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
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockRuns)
      });

      const { result, rerender } = renderHook(
        ({ token }) => useRuns(token),
        { initialProps: { token: null } }
      );

      expect(result.current.runs).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();

      rerender({ token: 'valid-token' });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.runs).toEqual(mockRuns);
      expect(mockFetch).toHaveBeenCalledWith('/api/runs', {
        headers: {
          'Authorization': 'Bearer valid-token'
        }
      });
    });

    it('refetches runs when token changes to different token', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockRuns)
      });

      const { result, rerender } = renderHook(
        ({ token }) => useRuns(token),
        { initialProps: { token: 'token1' } }
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const initialCallCount = mockFetch.mock.calls.length;

      rerender({ token: 'token2' });

      await waitFor(() => {
        expect(mockFetch.mock.calls.length).toBeGreaterThan(initialCallCount);
      });

      expect(mockFetch).toHaveBeenLastCalledWith('/api/runs', {
        headers: {
          'Authorization': 'Bearer token2'
        }
      });
    });

    it('does not fetch when token changes to null', () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockRuns)
      });

      const { rerender } = renderHook(
        ({ token }) => useRuns(token),
        { initialProps: { token: 'valid-token' } }
      );

      const initialCallCount = mockFetch.mock.calls.length;

      rerender({ token: null });

      // Should not make additional calls
      expect(mockFetch.mock.calls.length).toBe(initialCallCount);
    });
  });

  describe('Data Transformations', () => {
    it('converts form data correctly for API', async () => {
      const formData: RunFormData = {
        date: '2024-06-16',
        distance: '10.5',
        duration: '65', // 1 hour 5 minutes
        tag: 'Long Run',
        notes: 'Great weather'
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({})
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue([])
        });

      const { result } = renderHook(() => useRuns('valid-token'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.saveRun(formData);
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/runs', expect.objectContaining({
        body: JSON.stringify({
          date: new Date('2024-06-16').toISOString(),
          distance: 10.5,
          duration: 3900, // 65 minutes * 60 seconds
          tag: 'Long Run',
          notes: 'Great weather'
        })
      }));
    });

    it('handles decimal distance values correctly', async () => {
      const formData: RunFormData = {
        date: '2024-06-16',
        distance: '5.123',
        duration: '30.5',
        tag: '',
        notes: ''
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({})
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue([])
        });

      const { result } = renderHook(() => useRuns('valid-token'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.saveRun(formData);
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/runs', expect.objectContaining({
        body: JSON.stringify({
          date: new Date('2024-06-16').toISOString(),
          distance: 5.123,
          duration: 1830, // 30.5 minutes * 60 seconds
          tag: null,
          notes: null
        })
      }));
    });
  });

  describe('Error Logging', () => {
    it('logs errors to console on fetch failure', async () => {
      const error = new Error('Network failure');
      mockFetch.mockRejectedValue(error);

      renderHook(() => useRuns('valid-token'));

      await waitFor(() => {
        expect(console.error).toHaveBeenCalledWith('Failed to fetch runs:', error);
      });
    });

    it('logs errors to console on save failure', async () => {
      const error = new Error('Save failure');
      mockFetch.mockRejectedValue(error);

      const { result } = renderHook(() => useRuns('valid-token'));

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
            notes: ''
          });
        });
      } catch (e) {
        // Expected to throw
      }

      expect(console.error).toHaveBeenCalledWith('Failed to save run:', error);
    });

    it('logs errors to console on delete failure', async () => {
      const error = new Error('Delete failure');
      mockFetch.mockRejectedValue(error);

      const { result } = renderHook(() => useRuns('valid-token'));

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