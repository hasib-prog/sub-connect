/**
 * useSocket — Socket.io client hook
 * Authenticates via JWT, auto-joins rooms, exposes event helpers
 */
'use client';
import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../store/authStore';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:5000';

let globalSocket: Socket | null = null;

export function useSocket() {
  const { accessToken, user } = useAuthStore();
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!accessToken || !user) return;

    if (!globalSocket || !globalSocket.connected) {
      globalSocket = io(WS_URL, {
        auth: { token: accessToken },
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
      });

      globalSocket.on('connect', () => {
        console.log('[Socket] Connected:', globalSocket?.id);
        globalSocket?.emit('join:rooms');
      });

      globalSocket.on('connect_error', (err) => {
        console.error('[Socket] Connection error:', err.message);
      });

      globalSocket.on('disconnect', (reason) => {
        console.log('[Socket] Disconnected:', reason);
      });
    }

    socketRef.current = globalSocket;

    return () => {
      // Don't disconnect on component unmount — keep global connection alive
    };
  }, [accessToken, user]);

  const sendMessage = useCallback(
    (data: { roomId: string; content: string; receiverId?: string }) => {
      return new Promise<{ messageId?: string; error?: string }>((resolve) => {
        socketRef.current?.emit('message:send', data, resolve);
      });
    },
    []
  );

  const openDM = useCallback((targetUserId: string) => {
    return new Promise<{ roomId?: string; error?: string }>((resolve) => {
      socketRef.current?.emit('chat:open-dm', { targetUserId }, resolve);
    });
  }, []);

  const startTyping = useCallback((roomId: string) => {
    socketRef.current?.emit('typing:start', { roomId });
  }, []);

  const stopTyping = useCallback((roomId: string) => {
    socketRef.current?.emit('typing:stop', { roomId });
  }, []);

  const markSeen = useCallback((roomId: string) => {
    socketRef.current?.emit('message:seen', { roomId });
  }, []);

  const checkPresence = useCallback(
    (userIds: string[]): Promise<Record<string, boolean>> => {
      return new Promise((resolve) => {
        socketRef.current?.emit('presence:check', { userIds }, resolve);
      });
    },
    []
  );

  const on = useCallback((event: string, handler: (...args: any[]) => void) => {
    socketRef.current?.on(event, handler);
    return () => socketRef.current?.off(event, handler);
  }, []);

  return {
    socket: socketRef.current,
    sendMessage,
    openDM,
    startTyping,
    stopTyping,
    markSeen,
    checkPresence,
    on,
  };
}
