/**
 * Auth Store — Zustand
 * Persisted session state, role-aware helpers
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authApi } from '../lib/api';

export interface UserProfile {
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  bio?: string;
  department?: string;
  semester?: number;
  jobTitle?: string;
  currentCompany?: string;
  graduationYear?: number;
  isOpenToWork?: boolean;
  isOpenToMentor?: boolean;
  profileStrength?: number;
  skills?: Array<{ skill: { name: string } }>;
}

export interface AuthUser {
  id: string;
  email: string;
  role: 'STUDENT' | 'ALUMNI' | 'ADMIN';
  isEmailVerified: boolean;
  profile: UserProfile;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  isLoading: boolean;

  setAuth: (user: AuthUser, token: string) => void;
  setUser: (user: AuthUser) => void;
  clearAuth: () => void;
  refreshMe: () => Promise<void>;
  isStudent: () => boolean;
  isAlumni: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      isLoading: false,

      setAuth: (user, accessToken) => {
        localStorage.setItem('access_token', accessToken);
        set({ user, accessToken });
      },

      setUser: (user) => set({ user }),

      clearAuth: () => {
        localStorage.removeItem('access_token');
        set({ user: null, accessToken: null });
      },

      refreshMe: async () => {
        set({ isLoading: true });
        try {
          const { data } = await authApi.me();
          set({ user: data.user });
        } finally {
          set({ isLoading: false });
        }
      },

      isStudent: () => get().user?.role === 'STUDENT',
      isAlumni: () => get().user?.role === 'ALUMNI',
    }),
    {
      name: 'sub-connect-auth',
      partialize: (state) => ({ user: state.user, accessToken: state.accessToken }),
    }
  )
);
