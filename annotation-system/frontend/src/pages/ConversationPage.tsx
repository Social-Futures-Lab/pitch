import { useParams, useNavigate } from "react-router-dom";
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  memo,
} from "react";
import { useAuth } from "@/hooks/useAuth";
import { useWebSocket } from "@/hooks/useWebSocket";
import { getConversation, endConversation, getMyFlags } from "@/api/conversations";
import type { Turn, Conversation, WebSocketMessage } from "@/types";
import PromptBanner from "@/components/chat/PromptBanner";
import ChatMessage from "@/components/chat/ChatMessage";
import TypingIndicator from "@/components/chat/TypingIndicator";
import ParticipantList from "@/components/chat/ParticipantList";

const MemoizedTypingIndicator = memo(TypingIndicator);

const MessageList = memo(function MessageList({
  turns,
  speakerMap,
  currentUserId,
  conversationEnded,
  messagesEndRef,
  onToggleFlag,
}: {
  turns: Turn[];
  speakerMap: Map<string, number>;
  currentUserId: string | undefined;
  conversationEnded: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  onToggleFlag?: (turnId: string, flagged: boolean) => void;
}) {
  return (
    <div className={`flex-1 overflow-y-auto px-4 py-4 ${conversationEnded ? "opacity-50" : ""}`}>
      {turns.length === 0 && !conversationEnded && (
        <div className="flex h-full items-center justify-center text-sm text-gray-400">
          No messages yet. Start the conversation!
        </div>
      )}
      {turns.map((turn) => (
        <ChatMessage
          key={turn.id}
          turn={turn}
          speakerIndex={speakerMap.get(turn.speaker_id) ?? 0}
          isCurrentUser={turn.speaker_id === currentUserId}
          onToggleFlag={onToggleFlag}
        />
      ))}
      <div ref={messagesEndRef} />
    </div>
  );
});

export default function ConversationPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const { user, token } = useAuth();
  const navigate = useNavigate();

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ending, setEnding] = useState(false);
  const [conversationEnded, setConversationEnded] = useState(false);
  const [showBookmarkTutorial, setShowBookmarkTutorial] = useState(
    () => !localStorage.getItem("pitch-bookmark-tutorial-dismissed")
  );
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);

  const [inputAreaHeight, setInputAreaHeight] = useState(100);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const inputValueRef = useRef(inputValue);
  const prevConnectedRef = useRef(false);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = inputAreaHeight;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const delta = startY - moveEvent.clientY;
        const newHeight = Math.max(72, Math.min(startHeight + delta, 400));
        setInputAreaHeight(newHeight);
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [inputAreaHeight]
  );

  // Fetch conversation
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const [conv, flags] = await Promise.all([
          getConversation(conversationId!),
          getMyFlags(conversationId!),
        ]);
        if (!cancelled) {
          setConversation(conv);
          if (conv.ended_at) {
            setConversationEnded(true);
          }
          const flaggedTurnIds = new Set(flags.map((f) => f.turn_id));
          const existingTurns: Turn[] = (conv.turns ?? []).map((t) => ({
            id: t.id,
            conversation_id: t.conversation_id,
            turn_number: t.turn_number,
            speaker_id: t.speaker_id,
            speaker_name: t.speaker_name,
            text: ("text" in t ? t.text : (t as unknown as { content: string }).content) as string,
            timestamp: ("timestamp" in t ? t.timestamp : (t as unknown as { created_at: string }).created_at) as string,
            flagged: flaggedTurnIds.has(t.id),
          }));
          setTurns(existingTurns);
        }
      } catch {
        if (!cancelled) {
          setLoadError("Failed to load conversation.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const wsEndpoint = conversation ? `conversation/${conversation.id}` : "";

  const handleWsMessage = useCallback(
    (msg: WebSocketMessage) => {
      switch (msg.type) {
        case "connected": {
          const onlineIds = msg.payload.online_users as string[] | undefined;
          if (onlineIds) setOnlineUserIds(onlineIds);
          const memberList = msg.payload.members as { id: string; name: string }[] | undefined;
          if (memberList) setMembers(memberList);
          break;
        }
        case "user_joined":
        case "user_left": {
          const onlineIds = msg.payload.online_users as string[] | undefined;
          if (onlineIds) setOnlineUserIds(onlineIds);
          break;
        }
        case "new_turn": {
          const turn = (msg.payload as { turn?: Record<string, unknown> }).turn;
          if (!turn) break;
          const newTurn: Turn = {
            id: (turn.id as string) ?? crypto.randomUUID(),
            conversation_id: (turn.conversation_id as string) ?? "",
            turn_number: (turn.turn_number as number) ?? 0,
            speaker_id: (turn.speaker_id as string) ?? "",
            speaker_name: (turn.speaker_name as string) ?? "Unknown",
            text: (turn.text as string) ?? "",
            timestamp: (turn.timestamp as string) ?? msg.timestamp,
          };
          setTurns((prev) => {
            if (prev.some((t) => t.id === newTurn.id)) return prev;
            return [...prev, newTurn];
          });
          setTypingUsers((prev) =>
            prev.filter((u) => u !== newTurn.speaker_name)
          );
          break;
        }
        case "typing_start": {
          const name = (msg.payload.typing_user_name as string) ?? "";
          if (name && name !== user?.name) {
            setTypingUsers((prev) =>
              prev.includes(name) ? prev : [...prev, name]
            );
          }
          break;
        }
        case "typing_stop": {
          const name = (msg.payload.typing_user_name as string) ?? "";
          setTypingUsers((prev) => prev.filter((u) => u !== name));
          break;
        }
        case "flag_created": {
          const flag = msg.payload.flag as { turn_id?: string } | undefined;
          if (flag?.turn_id) {
            setTurns((prev) =>
              prev.map((t) =>
                t.id === flag.turn_id ? { ...t, flagged: true } : t
              )
            );
          }
          break;
        }
        case "flag_removed": {
          const turnId = msg.payload.turn_id as string | undefined;
          if (turnId) {
            setTurns((prev) =>
              prev.map((t) =>
                t.id === turnId ? { ...t, flagged: false } : t
              )
            );
          }
          break;
        }
        case "conversation_ended": {
          setConversationEnded(true);
          break;
        }
        default:
          break;
      }
    },
    [user?.name]
  );

  const {
    sendMessage,
    sendTypingEvent,
    sendFlag,
    sendUnflag,
    connected,
    error: wsError,
  } = useWebSocket({
    endpoint: wsEndpoint,
    token,
    enabled: !!conversation && !conversationEnded,
    onMessage: handleWsMessage,
  });

  // Restore focus after reconnect and keep inputValueRef in sync
  useEffect(() => {
    inputValueRef.current = inputValue;
  }, [inputValue]);

  useEffect(() => {
    if (connected && !prevConnectedRef.current) {
      // Just reconnected — restore focus and ensure input value is intact
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          const len = inputRef.current.value.length;
          inputRef.current.setSelectionRange(len, len);
        }
      }, 0);
    }
    prevConnectedRef.current = connected;
  }, [connected]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns.length]);

  // Build speaker index map for coloring
  const speakerMap = useMemo(() => {
    const map = new Map<string, number>();
    let idx = 0;
    for (const turn of turns) {
      if (!map.has(turn.speaker_id)) {
        map.set(turn.speaker_id, idx++);
      }
    }
    return map;
  }, [turns]);

  // Handle typing events with debounce
  const handleInputChange = useCallback(
    (value: string) => {
      setInputValue(value);
      if (!isTypingRef.current && value.length > 0) {
        isTypingRef.current = true;
        sendTypingEvent(true);
      }
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      typingTimeoutRef.current = setTimeout(() => {
        if (isTypingRef.current) {
          isTypingRef.current = false;
          sendTypingEvent(false);
        }
      }, 2000);
    },
    [sendTypingEvent]
  );

  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    if (!text) return;
    const sent = sendMessage(text);
    if (!sent) return;
    setInputValue("");
    if (isTypingRef.current) {
      isTypingRef.current = false;
      sendTypingEvent(false);
    }
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    inputRef.current?.focus();
  }, [inputValue, sendMessage, sendTypingEvent]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleToggleFlag = useCallback(
    (turnId: string, flagged: boolean) => {
      if (flagged) {
        sendFlag(turnId, "");
      } else {
        sendUnflag(turnId);
      }
    },
    [sendFlag, sendUnflag]
  );

  const handleEndConversation = useCallback(async () => {
    if (!conversationId || ending) return;
    if (!window.confirm("End this conversation? This will move the group to the next stage.")) return;
    setEnding(true);
    try {
      await endConversation(conversationId);
    } catch {
      setEnding(false);
    }
  }, [conversationId, ending]);

  // Loading state
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-gray-400">Loading conversation...</div>
      </div>
    );
  }

  // Error state
  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-red-600">{loadError}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-3 text-sm text-indigo-600 hover:underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full max-w-5xl">
      {/* Main chat column */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Prompt Banner */}
        {conversation?.topic && <PromptBanner topic={conversation.topic} />}

        {/* Connection status — only show when active and disconnected */}
        {!conversationEnded && !connected && conversation && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-center text-xs text-amber-700">
            {wsError ?? "Reconnecting to chat..."}
          </div>
        )}

        {/* Chat messages area */}
        <MessageList
          turns={turns}
          speakerMap={speakerMap}
          currentUserId={user?.id}
          conversationEnded={conversationEnded}
          messagesEndRef={messagesEndRef}
          onToggleFlag={!conversationEnded ? handleToggleFlag : undefined}
        />

        {/* Bookmark tutorial / info icon */}
        {turns.length > 0 && !conversationEnded && (
          showBookmarkTutorial ? (
            <div className="border-b border-amber-100 bg-amber-50 px-4 py-3">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 text-amber-500">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                    <path d="M10 2c-1.716 0-3.408.106-5.07.31C3.806 2.45 3 3.414 3 4.517v11.907a.75.75 0 001.159.63L10 13.177l5.841 3.876A.75.75 0 0017 16.423V4.517c0-1.103-.806-2.068-1.93-2.207A41.403 41.403 0 0010 2z" />
                  </svg>
                </span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-amber-900">
                    Bookmark turns for later annotation
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-amber-800">
                    Hover over any message to reveal a bookmark icon. Mark turns where you feel
                    outside knowledge could be helpful. You'll revisit these in the annotation
                    stage to describe what a knowledgeable participant could have contributed.
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShowBookmarkTutorial(false);
                    localStorage.setItem("pitch-bookmark-tutorial-dismissed", "1");
                  }}
                  className="shrink-0 rounded px-2 py-1 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100"
                >
                  Dismiss
                </button>
              </div>
            </div>
          ) : (
            <div className="px-4 py-1">
              <button
                onClick={() => setShowBookmarkTutorial(true)}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-gray-400 transition-colors hover:bg-amber-50 hover:text-amber-500"
                title="How to mark turns for annotation"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path d="M10 2c-1.716 0-3.408.106-5.07.31C3.806 2.45 3 3.414 3 4.517v11.907a.75.75 0 001.159.63L10 13.177l5.841 3.876A.75.75 0 0017 16.423V4.517c0-1.103-.806-2.068-1.93-2.207A41.403 41.403 0 0010 2z" />
                </svg>
                <span className="text-[11px]">How to mark turns for annotation</span>
              </button>
            </div>
          )
        )}

        {/* Conversation ended overlay */}
        {conversationEnded && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/60">
            <div className="mx-4 w-full max-w-sm rounded-xl border border-gray-200 bg-white p-6 shadow-lg">
              <h2 className="text-lg font-semibold text-gray-900">
                Conversation Ended
              </h2>
              <p className="mt-2 text-sm text-gray-600">
                This conversation has ended. You can now proceed to Stage 2 to create inserted messages that could have augmented the group discussion.
              </p>
              <button
                onClick={() => navigate("/my-groups")}
                className="mt-5 w-full rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500"
              >
                Go to My Groups
              </button>
            </div>
          </div>
        )}

        {/* Typing indicator */}
        {!conversationEnded && <MemoizedTypingIndicator typingUsers={typingUsers} />}

        {/* Input area */}
        {!conversationEnded && (
          <div
            className="shrink-0 border-t border-gray-200 bg-white"
            style={{ height: `${inputAreaHeight}px` }}
          >
            {/* Drag handle */}
            <div
              data-testid="input-resize-handle"
              onMouseDown={handleResizeStart}
              className="flex h-3 cursor-row-resize items-center justify-center hover:bg-gray-50"
            >
              <div className="h-1 w-10 rounded-full bg-gray-300" />
            </div>
            {/* Textarea + Send */}
            <div className="flex h-[calc(100%-0.75rem)] items-end gap-2 px-4 pb-3">
              <textarea
                ref={inputRef}
                data-testid="chat-input"
                value={inputValue}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message... (Shift+Enter for newline)"
                disabled={!connected}
                className="flex-1 resize-none rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none disabled:bg-gray-100"
                style={{ height: "100%", overflowY: "auto" }}
              />
              <button
                data-testid="send-button"
                onClick={handleSend}
                disabled={!inputValue.trim() || !connected}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Send
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Participant sidebar */}
      {!conversationEnded && (
        <ParticipantList
          members={members}
          onlineUserIds={onlineUserIds}
          typingUsers={typingUsers}
          currentUserId={user?.id}
          onEndConversation={handleEndConversation}
          ending={ending}
        />
      )}
    </div>
  );
}
