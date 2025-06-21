export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

export interface Run {
  id: string;
  date: string;
  distance: number;
  duration: number;
  tag?: string;
  notes?: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunFormData {
  date: string;
  distance: string;
  duration: string;
  tag: string;
  notes: string;
}

export interface User {
  id: string;
  email: string;
}