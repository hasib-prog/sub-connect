/**
 * SUB Connect API Client
 * Axios instance with JWT refresh, error normalisation
 */

import axios, { AxiosError } from 'axios';

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

export const api = axios.create({
  baseURL: `${BASE}/api/v1`,
  withCredentials: true, // send refresh cookie
  timeout: 10_000,
});

// ─── Request interceptor — attach access token ────────────────────────────────
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('access_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ─── Response interceptor — silent token refresh ─────────────────────────────
let isRefreshing = false;
let queue: Array<(token: string) => void> = [];

api.interceptors.response.use(
  (res) => res,
  async (err: AxiosError) => {
    const original = err.config as any;

    if (err.response?.status === 401 && !original._retry) {
      if (isRefreshing) {
        return new Promise((resolve) => {
          queue.push((token) => {
            original.headers.Authorization = `Bearer ${token}`;
            resolve(api(original));
          });
        });
      }

      original._retry = true;
      isRefreshing = true;

      try {
        const { data } = await axios.post(
          `${BASE}/api/v1/auth/refresh`,
          {},
          { withCredentials: true }
        );
        const newToken = data.accessToken;
        localStorage.setItem('access_token', newToken);
        queue.forEach((cb) => cb(newToken));
        queue = [];
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch {
        localStorage.removeItem('access_token');
        if (typeof window !== 'undefined') window.location.href = '/login';
        return Promise.reject(err);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(err);
  }
);

// ─── Typed API helpers ────────────────────────────────────────────────────────

export const authApi = {
  register: (data: any) => api.post('/auth/register', data),
  login: (data: any) => api.post('/auth/login', data),
  logout: () => api.post('/auth/logout'),
  me: () => api.get('/auth/me'),
};

export const usersApi = {
  getProfile: (id: string) => api.get(`/users/${id}`),
  getPreview: (id: string) => api.get(`/users/${id}/preview`),
  updateProfile: (data: any) => api.put('/users/profile', data),
  getSuggestions: () => api.get('/users/suggestions/alumni'),
  addExperience: (data: any) => api.post('/users/experiences', data),
  deleteExperience: (id: string) => api.delete(`/users/experiences/${id}`),
  addProject: (data: any) => api.post('/users/projects', data),
};

export const postsApi = {
  getFeed: (cursor?: string) =>
    api.get('/posts/feed', { params: { cursor, limit: 10 } }),
  create: (data: any) => api.post('/posts', data),
  delete: (id: string) => api.delete(`/posts/${id}`),
  like: (id: string) => api.post(`/posts/${id}/like`),
  getComments: (id: string, cursor?: string) =>
    api.get(`/posts/${id}/comments`, { params: { cursor } }),
  addComment: (id: string, content: string, parentId?: string) =>
    api.post(`/posts/${id}/comments`, { content, parentId }),
  getUserPosts: (userId: string, cursor?: string) =>
    api.get(`/posts/user/${userId}`, { params: { cursor } }),
};

export const jobsApi = {
  list: (params?: any) => api.get('/jobs', { params }),
  get: (id: string) => api.get(`/jobs/${id}`),
  create: (data: any) => api.post('/jobs', data),
  apply: (id: string, data: any) => api.post(`/jobs/${id}/apply`, data),
  save: (id: string) => api.post(`/jobs/${id}/save`),
  myPostings: () => api.get('/jobs/poster/mine'),
  getApplications: (id: string) => api.get(`/jobs/${id}/applications`),
  updateApplicationStatus: (jobId: string, appId: string, status: string) =>
    api.patch(`/jobs/${jobId}/applications/${appId}`, { status }),
};

export const mentorshipApi = {
  getAvailable: (cursor?: string) =>
    api.get('/mentorship/available', { params: { cursor } }),
  request: (mentorId: string, message?: string) =>
    api.post('/mentorship/request', { mentorId, message }),
  respond: (id: string, status: 'ACCEPTED' | 'REJECTED') =>
    api.patch(`/mentorship/${id}/respond`, { status }),
  mine: () => api.get('/mentorship/mine'),
};

export const searchApi = {
  search: (params: any) => api.get('/search', { params }),
};

export const chatApi = {
  getRooms: () => api.get('/chat/rooms'),
  getMessages: (roomId: string, cursor?: string) =>
    api.get(`/chat/rooms/${roomId}/messages`, { params: { cursor } }),
};

export const notificationsApi = {
  list: (cursor?: string) => api.get('/notifications', { params: { cursor } }),
  readAll: () => api.patch('/notifications/read-all'),
  read: (id: string) => api.patch(`/notifications/${id}/read`),
};

export const connectionsApi = {
  send: (toId: string) => api.post('/connections', { toId }),
  respond: (id: string, status: 'ACCEPTED' | 'REJECTED') =>
    api.patch(`/connections/${id}`, { status }),
  list: (status?: string) => api.get('/connections', { params: { status } }),
};
