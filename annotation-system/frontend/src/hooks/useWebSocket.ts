import { useState, useEffect, useRef, useCallback } from "react";
import type { WebSocketMessage } from "@/types";

interface UseWebSocketOptions {
  endpoint: string;
  token: string | null;
  enabled?: boolean;
  onMessage?: (message: WebSocketMessage) => void;
}

interface UseWebSocketReturn {
  sendMessage: (content: string) => void;
  sendTypingEvent: (isTyping: boolean) => void;
  sendFlag: (turnId: string, reason: string) => void;
  sendUnflag: (turnId: string) => void;
  connected: boolean;
  error: string | null;
}

const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY = 1000;

export function useWebSocket({
  endpoint,
  token,
  enabled = true,
  onMessage,
}: UseWebSocketOptions): UseWebSocketReturn {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const connect = useCallback(() => {
    if (!token || !enabled || !endpoint) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const url = `${protocol}//${host}/ws/${endpoint}?token=${encodeURIComponent(token)}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setError(null);
      reconnectAttemptsRef.current = 0;
    };

    ws.onmessage = (event) => {
      try {
        const raw = JSON.parse(event.data);
        const message: WebSocketMessage = {
          type: raw.type ?? "system",
          payload: raw,
          timestamp: raw.timestamp ?? new Date().toISOString(),
        };
        onMessageRef.current?.(message);
      } catch {
        setError("Failed to parse incoming message");
      }
    };

    ws.onerror = () => {
      setError("WebSocket connection error");
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;

      if (
        enabled &&
        reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS
      ) {
        const delay =
          BASE_RECONNECT_DELAY *
          Math.pow(2, reconnectAttemptsRef.current);
        reconnectAttemptsRef.current += 1;
        reconnectTimeoutRef.current = setTimeout(connect, delay);
      } else if (
        reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS
      ) {
        setError("Maximum reconnection attempts reached");
      }
    };
  }, [endpoint, token, enabled]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  const send = useCallback(
    (data: Record<string, unknown>): boolean => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(data));
        return true;
      }
      return false;
    },
    []
  );

  const sendMessage = useCallback(
    (text: string) => {
      return send({ type: "message", text });
    },
    [send]
  );

  const sendTypingEvent = useCallback(
    (isTyping: boolean) => {
      send({ type: isTyping ? "typing_start" : "typing_stop" });
    },
    [send]
  );

  const sendFlag = useCallback(
    (turnId: string, _reason: string) => {
      send({ type: "flag", turn_id: turnId });
    },
    [send]
  );

  const sendUnflag = useCallback(
    (turnId: string) => {
      send({ type: "unflag", turn_id: turnId });
    },
    [send]
  );

  return {
    sendMessage,
    sendTypingEvent,
    sendFlag,
    sendUnflag,
    connected,
    error,
  };
}
