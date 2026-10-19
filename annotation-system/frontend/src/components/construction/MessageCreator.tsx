import { useState, useCallback } from "react";
import { aiGenerateMessage, getAiSuggestionForConversation } from "@/api/construction";
import type { PlacementWindow } from "@/components/construction/TranscriptReview";

interface InsertedResource {
  id: string;
  title: string;
  snippet?: string;
  url?: string;
  source: string;
}

export interface AIInteraction {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

interface MessageCreatorProps {
  conversationId: string;
  window: PlacementWindow;
  intentionTag: string;
  contributionType: string;
  pertinence: number;
  insertedResources: InsertedResource[];
  value: string;
  onChange: (value: string) => void;
  aiInteractionLog: AIInteraction[];
  onAiInteractionLog: (log: AIInteraction[]) => void;
}

export default function MessageCreator({
  conversationId,
  window: placementWindow,
  intentionTag,
  contributionType,
  pertinence,
  insertedResources,
  value,
  onChange,
  aiInteractionLog,
  onAiInteractionLog,
}: MessageCreatorProps) {
  const [mode, setMode] = useState<"generate" | "manual">("generate");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [aiPreview, setAiPreview] = useState<string | null>(null);
  const [followUpText, setFollowUpText] = useState("");
  const [polishing, setPolishing] = useState(false);
  const [polishPreview, setPolishPreview] = useState<string | null>(null);

  const handleGenerate = useCallback(async (followUp?: string, isRegenerate?: boolean) => {
    if (!conversationId || !placementWindow.startTurn || !placementWindow.endTurn || !placementWindow.bestTurn) return;

    setGenerating(true);
    setGenError(null);

    const previousMessages = aiInteractionLog
      .filter(m => m.role === "user" || m.role === "assistant")
      .map(m => ({ role: m.role, content: m.content }));

    try {
      const result = await aiGenerateMessage(conversationId, {
        windowStart: placementWindow.startTurn,
        windowEnd: placementWindow.endTurn,
        bestTurn: placementWindow.bestTurn,
        intentionTag,
        contributionType,
        pertinence,
        insertedResources,
        followUpPrompt: followUp,
        previousMessages: previousMessages.length > 0 ? previousMessages : undefined,
      });

      setAiPreview(result.message);

      const newLog: AIInteraction[] = [...aiInteractionLog];
      if (followUp) {
        newLog.push({ role: "user", content: `[Follow-up] ${followUp}`, timestamp: new Date().toISOString() });
      } else if (isRegenerate) {
        newLog.push({ role: "user", content: "[Regenerate request] Discarded previous message and requested a fresh generation", timestamp: new Date().toISOString() });
      } else {
        newLog.push({ role: "user", content: "[Initial generation request]", timestamp: new Date().toISOString() });
      }
      newLog.push({ role: "assistant", content: result.message, timestamp: new Date().toISOString() });
      onAiInteractionLog(newLog);
    } catch {
      setGenError("Message generation failed. Try again or write manually.");
    } finally {
      setGenerating(false);
      setFollowUpText("");
    }
  }, [conversationId, placementWindow, intentionTag, contributionType, pertinence, insertedResources, aiInteractionLog, onAiInteractionLog]);

  const handleAcceptPreview = useCallback(() => {
    if (aiPreview) {
      onChange(aiPreview);
      setAiPreview(null);
      const newLog: AIInteraction[] = [...aiInteractionLog];
      newLog.push({ role: "user", content: "[Accepted] User accepted the AI-generated message", timestamp: new Date().toISOString() });
      onAiInteractionLog(newLog);
    }
  }, [aiPreview, onChange, aiInteractionLog, onAiInteractionLog]);

  const handleRejectPreview = useCallback(() => {
    if (aiPreview) {
      const newLog: AIInteraction[] = [...aiInteractionLog];
      newLog.push({ role: "user", content: "[Rejected] User rejected the AI-generated message", timestamp: new Date().toISOString() });
      onAiInteractionLog(newLog);
    }
    setAiPreview(null);
  }, [aiPreview, aiInteractionLog, onAiInteractionLog]);

  const handleFollowUp = useCallback(() => {
    if (!followUpText.trim()) return;
    handleGenerate(followUpText.trim());
  }, [followUpText, handleGenerate]);

  const handlePolish = useCallback(async () => {
    if (!value.trim() || !conversationId || !placementWindow.startTurn || !placementWindow.endTurn || !placementWindow.bestTurn) return;

    setPolishing(true);
    try {
      const result = await getAiSuggestionForConversation(
        conversationId,
        contributionType,
        pertinence,
        placementWindow.startTurn,
        placementWindow.endTurn,
        placementWindow.bestTurn,
        insertedResources,
        value,
        "polish"
      );
      setPolishPreview(result.suggestion);

      const newLog: AIInteraction[] = [...aiInteractionLog];
      const truncated = value.length > 200 ? value.slice(0, 200) + "..." : value;
      newLog.push({ role: "user", content: `[Polish request] User requested AI polish of their manual text. Original (${value.length} chars): "${truncated}"`, timestamp: new Date().toISOString() });
      newLog.push({ role: "assistant", content: result.suggestion, timestamp: new Date().toISOString() });
      onAiInteractionLog(newLog);
    } catch {
      setGenError("Polish failed. Your text is preserved — try again or keep it as-is.");
    } finally {
      setPolishing(false);
    }
  }, [value, conversationId, placementWindow, contributionType, pertinence, insertedResources, aiInteractionLog, onAiInteractionLog]);

  const handleAcceptPolish = useCallback(() => {
    if (polishPreview) {
      onChange(polishPreview);
      setPolishPreview(null);
      const newLog: AIInteraction[] = [...aiInteractionLog];
      newLog.push({ role: "user", content: "[Accepted polish] User replaced their text with the polished version", timestamp: new Date().toISOString() });
      onAiInteractionLog(newLog);
    }
  }, [polishPreview, onChange, aiInteractionLog, onAiInteractionLog]);

  const handleRejectPolish = useCallback(() => {
    if (polishPreview) {
      const newLog: AIInteraction[] = [...aiInteractionLog];
      newLog.push({ role: "user", content: "[Rejected polish] User kept their original text", timestamp: new Date().toISOString() });
      onAiInteractionLog(newLog);
    }
    setPolishPreview(null);
  }, [polishPreview, aiInteractionLog, onAiInteractionLog]);

  return (
    <div className="space-y-3">
      {/* Mode toggle */}
      <div className="flex items-center gap-1 rounded-md bg-white border border-gray-300 p-0.5">
        <button
          onClick={() => setMode("generate")}
          className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
            mode === "generate"
              ? "bg-violet-600 text-white shadow-sm"
              : "text-gray-600 hover:text-gray-800"
          }`}
        >
          Generate with AI
        </button>
        <button
          onClick={() => setMode("manual")}
          className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
            mode === "manual"
              ? "bg-violet-600 text-white shadow-sm"
              : "text-gray-600 hover:text-gray-800"
          }`}
        >
          Write manually
        </button>
      </div>

      {mode === "generate" ? (
        <div className="space-y-3">
          {/* Generate button */}
          {!aiPreview && !value && (
            <button
              onClick={() => handleGenerate()}
              disabled={generating}
              className="w-full rounded-md bg-violet-600 px-4 py-3 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50 transition-colors"
            >
              {generating ? (
                <span className="inline-flex items-center gap-2">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Generating message...
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path d="M15.98 1.804a1 1 0 00-1.96 0l-.24 1.192a1 1 0 01-.784.784l-1.192.24a1 1 0 000 1.96l1.192.24a1 1 0 01.784.784l.24 1.192a1 1 0 001.96 0l.24-1.192a1 1 0 01.784-.784l1.192-.24a1 1 0 000-1.96l-1.192-.24a1 1 0 01-.784-.784l-.24-1.192zM5.98 7.804a1 1 0 00-1.96 0l-.24 1.192a1 1 0 01-.784.785l-1.192.24a1 1 0 000 1.958l1.192.24a1 1 0 01.784.785l.24 1.192a1 1 0 001.96 0l.24-1.192a1 1 0 01.784-.785l1.192-.24a1 1 0 000-1.958l-1.192-.24a1 1 0 01-.784-.785l-.24-1.192z" />
                  </svg>
                  Generate Message
                </span>
              )}
            </button>
          )}

          {/* AI Preview */}
          {aiPreview && (
            <div className="rounded-md border border-violet-200 bg-violet-50 p-3 space-y-2">
              <p className="text-xs font-semibold text-violet-700">AI-Generated Message:</p>
              <div className="rounded-md border border-gray-200 bg-white p-3">
                <p className="text-sm text-gray-800 whitespace-pre-wrap">{aiPreview}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleAcceptPreview}
                  className="flex-1 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 transition-colors"
                >
                  Accept
                </button>
                <button
                  onClick={handleRejectPreview}
                  className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Reject
                </button>
              </div>
            </div>
          )}

          {/* Follow-up prompt */}
          {(aiPreview || value) && (
            <div className="flex gap-2">
              <input
                type="text"
                value={followUpText}
                onChange={(e) => setFollowUpText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleFollowUp()}
                placeholder="Ask AI to adjust (e.g., 'make it shorter', 'add more citations')..."
                className="flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
              <button
                onClick={handleFollowUp}
                disabled={!followUpText.trim() || generating}
                className="shrink-0 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-50 transition-colors"
              >
                {generating ? "..." : "Send"}
              </button>
            </div>
          )}

          {/* Accepted text editor */}
          {value && !aiPreview && (
            <div>
              <p className="mb-1 text-xs text-gray-500">You can edit the accepted message below:</p>
              <textarea
                rows={5}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
              <button
                onClick={() => handleGenerate(undefined, true)}
                disabled={generating}
                className="mt-1 text-xs text-violet-600 hover:text-violet-500"
              >
                Regenerate from scratch
              </button>
            </div>
          )}

          {genError && <p className="text-xs text-red-600">{genError}</p>}
        </div>
      ) : (
        /* Manual mode */
        <div className="space-y-2">
          <textarea
            rows={6}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Write a message that you think would actually help the group, e.g. 'According to Smith et al. (2023), the recommended approach is...'"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          />

          {/* Polish button */}
          {value.trim() && (
            <button
              onClick={handlePolish}
              disabled={polishing}
              className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
            >
              {polishing ? (
                <>
                  <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Polishing...
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                    <path d="M15.98 1.804a1 1 0 00-1.96 0l-.24 1.192a1 1 0 01-.784.784l-1.192.24a1 1 0 000 1.96l1.192.24a1 1 0 01.784.784l.24 1.192a1 1 0 001.96 0l.24-1.192a1 1 0 01.784-.784l1.192-.24a1 1 0 000-1.96l-1.192-.24a1 1 0 01-.784-.784l-.24-1.192zM5.98 7.804a1 1 0 00-1.96 0l-.24 1.192a1 1 0 01-.784.785l-1.192.24a1 1 0 000 1.958l1.192.24a1 1 0 01.784.785l.24 1.192a1 1 0 001.96 0l.24-1.192a1 1 0 01.784-.785l1.192-.24a1 1 0 000-1.958l-1.192-.24a1 1 0 01-.784-.785l-.24-1.192z" />
                  </svg>
                  Polish with AI
                </>
              )}
            </button>
          )}

          {/* Polish preview modal */}
          {polishPreview && (
            <div className="rounded-md border border-violet-200 bg-violet-50 p-3 space-y-2">
              <p className="text-xs font-semibold text-violet-700">Polished Version:</p>
              <div className="rounded-md border border-gray-200 bg-white p-3">
                <p className="text-sm text-gray-800 whitespace-pre-wrap">{polishPreview}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleAcceptPolish}
                  className="flex-1 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 transition-colors"
                >
                  Accept Polish
                </button>
                <button
                  onClick={handleRejectPolish}
                  className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Keep Original
                </button>
              </div>
            </div>
          )}

          {genError && <p className="text-xs text-red-600">{genError}</p>}
        </div>
      )}

      {/* AI Interaction History (collapsible) */}
      {aiInteractionLog.length > 0 && (
        <details className="rounded-md border border-gray-200 bg-gray-50">
          <summary className="cursor-pointer px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700">
            AI interaction history ({aiInteractionLog.length} messages)
          </summary>
          <div className="max-h-40 overflow-y-auto px-3 pb-2 space-y-1">
            {aiInteractionLog.map((msg, i) => (
              <div key={i} className={`rounded px-2 py-1 text-xs ${
                msg.role === "user" ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-700"
              }`}>
                <span className="font-medium">{msg.role === "user" ? "You" : "AI"}:</span>{" "}
                <span className="line-clamp-2">{msg.content}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
