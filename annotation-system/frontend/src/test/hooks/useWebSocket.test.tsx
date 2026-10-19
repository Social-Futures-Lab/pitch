import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWebSocket } from "@/hooks/useWebSocket";

// Mock WebSocket
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  readyState: number = WebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = WebSocket.CLOSED;
  }

  // Test helpers
  simulateOpen() {
    this.readyState = WebSocket.OPEN;
    this.onopen?.();
  }

  simulateMessage(data: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  simulateError() {
    this.onerror?.();
  }

  simulateClose() {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.();
  }
}

describe("useWebSocket", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("connects to the correct WebSocket URL", () => {
    // Set up location for the test
    Object.defineProperty(window, "location", {
      value: { protocol: "http:", host: "localhost:5173" },
      writable: true,
    });

    renderHook(() =>
      useWebSocket({
        endpoint: "conversation/conv-1",
        token: "my-token",
      })
    );

    expect(MockWebSocket.instances.length).toBe(1);
    expect(MockWebSocket.instances[0].url).toBe(
      "ws://localhost:5173/ws/conversation/conv-1?token=my-token"
    );
  });

  it("does not connect when token is null", () => {
    renderHook(() =>
      useWebSocket({
        endpoint: "conversation/conv-1",
        token: null,
      })
    );

    expect(MockWebSocket.instances.length).toBe(0);
  });

  it("does not connect when enabled is false", () => {
    renderHook(() =>
      useWebSocket({
        endpoint: "conversation/conv-1",
        token: "my-token",
        enabled: false,
      })
    );

    expect(MockWebSocket.instances.length).toBe(0);
  });

  it("sets connected=true on open", () => {
    const { result } = renderHook(() =>
      useWebSocket({
        endpoint: "conversation/conv-1",
        token: "my-token",
      })
    );

    expect(result.current.connected).toBe(false);

    act(() => {
      MockWebSocket.instances[0].simulateOpen();
    });

    expect(result.current.connected).toBe(true);
  });

  it("calls onMessage callback for incoming messages", () => {
    const onMessage = vi.fn();
    renderHook(() =>
      useWebSocket({
        endpoint: "conversation/conv-1",
        token: "my-token",
        onMessage,
      })
    );

    act(() => {
      MockWebSocket.instances[0].simulateOpen();
    });

    act(() => {
      MockWebSocket.instances[0].simulateMessage({
        type: "new_turn",
        turn: { id: "1", text: "Hello!" },
        timestamp: "2026-04-27T10:00:00Z",
      });
    });

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith({
      type: "new_turn",
      payload: {
        type: "new_turn",
        turn: { id: "1", text: "Hello!" },
        timestamp: "2026-04-27T10:00:00Z",
      },
      timestamp: "2026-04-27T10:00:00Z",
    });
  });

  it("calls onMessage for each message without dropping", () => {
    const onMessage = vi.fn();
    renderHook(() =>
      useWebSocket({
        endpoint: "conversation/conv-1",
        token: "my-token",
        onMessage,
      })
    );

    act(() => {
      MockWebSocket.instances[0].simulateOpen();
    });

    act(() => {
      MockWebSocket.instances[0].simulateMessage({
        type: "new_turn",
        turn: { id: "1", text: "First" },
        timestamp: "2026-04-27T10:00:00Z",
      });
      MockWebSocket.instances[0].simulateMessage({
        type: "new_turn",
        turn: { id: "2", text: "Second" },
        timestamp: "2026-04-27T10:01:00Z",
      });
    });

    expect(onMessage).toHaveBeenCalledTimes(2);
  });

  it("sendMessage sends correct format when connected", () => {
    const { result } = renderHook(() =>
      useWebSocket({
        endpoint: "conversation/conv-1",
        token: "my-token",
      })
    );

    const ws = MockWebSocket.instances[0];

    act(() => {
      ws.simulateOpen();
    });

    act(() => {
      result.current.sendMessage("Hello world");
    });

    expect(ws.sentMessages).toHaveLength(1);
    const sent = JSON.parse(ws.sentMessages[0]);
    expect(sent.type).toBe("message");
    expect(sent.text).toBe("Hello world");
  });

  it("sendTypingEvent sends typing_start and typing_stop", () => {
    const { result } = renderHook(() =>
      useWebSocket({
        endpoint: "conversation/conv-1",
        token: "my-token",
      })
    );

    const ws = MockWebSocket.instances[0];

    act(() => {
      ws.simulateOpen();
    });

    act(() => {
      result.current.sendTypingEvent(true);
    });

    act(() => {
      result.current.sendTypingEvent(false);
    });

    expect(ws.sentMessages).toHaveLength(2);
    expect(JSON.parse(ws.sentMessages[0]).type).toBe("typing_start");
    expect(JSON.parse(ws.sentMessages[1]).type).toBe("typing_stop");
  });

  it("sendFlag sends flag event with turnId", () => {
    const { result } = renderHook(() =>
      useWebSocket({
        endpoint: "conversation/conv-1",
        token: "my-token",
      })
    );

    const ws = MockWebSocket.instances[0];

    act(() => {
      ws.simulateOpen();
    });

    act(() => {
      result.current.sendFlag("turn-5", "interesting");
    });

    expect(ws.sentMessages).toHaveLength(1);
    const sent = JSON.parse(ws.sentMessages[0]);
    expect(sent.type).toBe("flag");
    expect(sent.turn_id).toBe("turn-5");
  });

  it("sets error on WebSocket error", () => {
    const { result } = renderHook(() =>
      useWebSocket({
        endpoint: "conversation/conv-1",
        token: "my-token",
      })
    );

    act(() => {
      MockWebSocket.instances[0].simulateError();
    });

    expect(result.current.error).toBe("WebSocket connection error");
  });

  it("sets connected=false on close", () => {
    const { result } = renderHook(() =>
      useWebSocket({
        endpoint: "conversation/conv-1",
        token: "my-token",
      })
    );

    act(() => {
      MockWebSocket.instances[0].simulateOpen();
    });

    expect(result.current.connected).toBe(true);

    act(() => {
      MockWebSocket.instances[0].simulateClose();
    });

    expect(result.current.connected).toBe(false);
  });

  it("attempts to reconnect on disconnect with exponential backoff", () => {
    renderHook(() =>
      useWebSocket({
        endpoint: "conversation/conv-1",
        token: "my-token",
      })
    );

    expect(MockWebSocket.instances).toHaveLength(1);

    // Simulate first disconnect
    act(() => {
      MockWebSocket.instances[0].simulateClose();
    });

    // After BASE_RECONNECT_DELAY (1000ms), should reconnect
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(MockWebSocket.instances).toHaveLength(2);

    // Simulate second disconnect
    act(() => {
      MockWebSocket.instances[1].simulateClose();
    });

    // After 2000ms (1000 * 2^1), should reconnect again
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(MockWebSocket.instances).toHaveLength(3);
  });

  it("stops reconnecting after MAX_RECONNECT_ATTEMPTS (5)", () => {
    const { result } = renderHook(() =>
      useWebSocket({
        endpoint: "conversation/conv-1",
        token: "my-token",
      })
    );

    // Close and advance for each reconnect attempt
    for (let i = 0; i < 5; i++) {
      act(() => {
        MockWebSocket.instances[MockWebSocket.instances.length - 1].simulateClose();
      });
      act(() => {
        vi.advanceTimersByTime(1000 * Math.pow(2, i));
      });
    }

    // Should have created 1 initial + 5 reconnect = 6 instances
    expect(MockWebSocket.instances).toHaveLength(6);

    // Sixth close should NOT create a new instance
    act(() => {
      MockWebSocket.instances[5].simulateClose();
    });
    act(() => {
      vi.advanceTimersByTime(100000);
    });

    expect(MockWebSocket.instances).toHaveLength(6);
    expect(result.current.error).toBe(
      "Maximum reconnection attempts reached"
    );
  });

  it("sets error for unparseable incoming messages", () => {
    const { result } = renderHook(() =>
      useWebSocket({
        endpoint: "conversation/conv-1",
        token: "my-token",
      })
    );

    act(() => {
      MockWebSocket.instances[0].simulateOpen();
    });

    act(() => {
      MockWebSocket.instances[0].onmessage?.({
        data: "not valid json{{{",
      });
    });

    expect(result.current.error).toBe("Failed to parse incoming message");
  });

  it("resets reconnect attempts on successful connection", () => {
    renderHook(() =>
      useWebSocket({
        endpoint: "conversation/conv-1",
        token: "my-token",
      })
    );

    // First disconnect + reconnect
    act(() => {
      MockWebSocket.instances[0].simulateClose();
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Successful reconnect
    act(() => {
      MockWebSocket.instances[1].simulateOpen();
    });

    // Close again - should start from attempt 0 again (delay 1000ms)
    act(() => {
      MockWebSocket.instances[1].simulateClose();
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Should have reconnected (3 total: initial + 2 reconnects)
    expect(MockWebSocket.instances).toHaveLength(3);
  });
});
