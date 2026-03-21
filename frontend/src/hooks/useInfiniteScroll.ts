/**
 * useInfiniteScroll — Cursor-based infinite scroll with intersection observer
 */
'use client';
import { useState, useCallback, useRef, useEffect } from 'react';

interface UseInfiniteScrollOptions<T> {
  fetchFn: (cursor?: string) => Promise<{ data: T[]; nextCursor: string | null }>;
  enabled?: boolean;
}

export function useInfiniteScroll<T>({ fetchFn, enabled = true }: UseInfiniteScrollOptions<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const fetchInitial = useCallback(async () => {
    if (!enabled) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchFn(undefined);
      setItems(result.data);
      setNextCursor(result.nextCursor);
      setHasMore(!!result.nextCursor);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to load');
    } finally {
      setIsLoading(false);
    }
  }, [fetchFn, enabled]);

  const fetchMore = useCallback(async () => {
    if (!nextCursor || isFetchingMore || !hasMore) return;
    setIsFetchingMore(true);
    try {
      const result = await fetchFn(nextCursor);
      setItems((prev) => [...prev, ...result.data]);
      setNextCursor(result.nextCursor);
      setHasMore(!!result.nextCursor);
    } catch {
      // Silent — user can scroll again to retry
    } finally {
      setIsFetchingMore(false);
    }
  }, [nextCursor, isFetchingMore, hasMore, fetchFn]);

  // Intersection observer triggers fetchMore when sentinel is visible
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) fetchMore();
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [fetchMore]);

  const prepend = useCallback((item: T) => {
    setItems((prev) => [item, ...prev]);
  }, []);

  const update = useCallback((predicate: (item: T) => boolean, updater: (item: T) => T) => {
    setItems((prev) => prev.map((item) => (predicate(item) ? updater(item) : item)));
  }, []);

  const remove = useCallback((predicate: (item: T) => boolean) => {
    setItems((prev) => prev.filter((item) => !predicate(item)));
  }, []);

  useEffect(() => { fetchInitial(); }, []);

  return {
    items,
    isLoading,
    isFetchingMore,
    hasMore,
    error,
    sentinelRef,
    refresh: fetchInitial,
    prepend,
    update,
    remove,
  };
}

/**
 * useDebounce — Debounce a value with configurable delay
 */
export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
