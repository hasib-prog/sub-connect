/**
 * useHoverProfile — Lazy-loaded hover profile with debounce + cache
 * 
 * Design decisions:
 * - 200ms delay before fetching — avoids API calls on quick mouse-overs
 * - In-memory LRU cache — subsequent hovers are instant
 * - AbortController — cancels in-flight requests when hover ends
 */
'use client';
import { useState, useRef, useCallback } from 'react';
import { usersApi } from '../lib/api';

interface HoverProfile {
  id: string;
  role: 'STUDENT' | 'ALUMNI';
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  isOpenToWork?: boolean;
  isOpenToMentor?: boolean;
  // Student
  department?: string;
  semester?: number;
  // Alumni
  jobTitle?: string;
  company?: string;
  graduationYear?: number;
  skills?: string[];
}

// Simple LRU-like cache: Map preserves insertion order
const previewCache = new Map<string, HoverProfile>();
const MAX_CACHE_SIZE = 50;

function cacheSet(key: string, value: HoverProfile) {
  if (previewCache.size >= MAX_CACHE_SIZE) {
    // Delete oldest entry
    previewCache.delete(previewCache.keys().next().value);
  }
  previewCache.set(key, value);
}

export function useHoverProfile() {
  const [profile, setProfile] = useState<HoverProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const onMouseEnter = useCallback(
    (userId: string, event: React.MouseEvent) => {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const x = Math.min(rect.right + 8, window.innerWidth - 280);
      const y = Math.min(rect.top, window.innerHeight - 300);
      setPosition({ x, y });

      timerRef.current = setTimeout(async () => {
        // Instant from cache
        const cached = previewCache.get(userId);
        if (cached) {
          setProfile(cached);
          setVisible(true);
          return;
        }

        setLoading(true);
        abortRef.current = new AbortController();

        try {
          const { data } = await usersApi.getPreview(userId);
          cacheSet(userId, data);
          setProfile(data);
          setVisible(true);
        } catch {
          // Silently ignore — hover card is non-critical
        } finally {
          setLoading(false);
        }
      }, 200); // 200ms debounce
    },
    []
  );

  const onMouseLeave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    abortRef.current?.abort();
    setVisible(false);
    setLoading(false);
  }, []);

  // Preload a user's preview into cache (call when user appears in viewport)
  const preload = useCallback(async (userId: string) => {
    if (previewCache.has(userId)) return;
    try {
      const { data } = await usersApi.getPreview(userId);
      cacheSet(userId, data);
    } catch {
      // silent
    }
  }, []);

  return { profile, loading, visible, position, onMouseEnter, onMouseLeave, preload };
}
