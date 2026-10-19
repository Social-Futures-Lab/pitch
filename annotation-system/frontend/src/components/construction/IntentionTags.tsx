import { useState, useEffect, useCallback } from "react";
import { getAiIntentions } from "@/api/construction";
import type { PlacementWindow } from "@/components/construction/TranscriptReview";

export interface IntentionSelection {
  tag: string;
  category: string;
}

interface IntentionTagsProps {
  conversationId: string;
  window: PlacementWindow;
  selectedTag: IntentionSelection | null;
  pinnedTag?: IntentionSelection | null;
  onSelect: (tag: IntentionSelection) => void;
}

const CATEGORY_STYLES: Record<string, { selected: string; hover: string; badge: string }> = {
  heads_up: {
    selected: "bg-blue-50 border-blue-300 text-blue-700 ring-2 ring-indigo-300 ring-offset-1",
    hover: "border-gray-200 bg-white text-gray-700 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700",
    badge: "bg-blue-50 text-blue-700",
  },
  pushback: {
    selected: "bg-amber-50 border-amber-300 text-amber-700 ring-2 ring-indigo-300 ring-offset-1",
    hover: "border-gray-200 bg-white text-gray-700 hover:bg-amber-50 hover:border-amber-300 hover:text-amber-700",
    badge: "bg-amber-50 text-amber-700",
  },
  support: {
    selected: "bg-teal-50 border-teal-300 text-teal-700 ring-2 ring-indigo-300 ring-offset-1",
    hover: "border-gray-200 bg-white text-gray-700 hover:bg-teal-50 hover:border-teal-300 hover:text-teal-700",
    badge: "bg-teal-50 text-teal-700",
  },
  suggestion: {
    selected: "bg-emerald-50 border-emerald-300 text-emerald-700 ring-2 ring-indigo-300 ring-offset-1",
    hover: "border-gray-200 bg-white text-gray-700 hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700",
    badge: "bg-emerald-50 text-emerald-700",
  },
  others: {
    selected: "bg-purple-50 border-purple-300 text-purple-700 ring-2 ring-indigo-300 ring-offset-1",
    hover: "border-gray-200 bg-white text-gray-700 hover:bg-purple-50 hover:border-purple-300 hover:text-purple-700",
    badge: "bg-purple-50 text-purple-700",
  },
};

const CATEGORY_LABELS: Record<string, string> = {
  heads_up: "Heads-up",
  pushback: "Pushback",
  support: "Support",
  suggestion: "Suggestion",
  others: "Other",
};

export default function IntentionTags({
  conversationId,
  window: placementWindow,
  selectedTag,
  pinnedTag,
  onSelect,
}: IntentionTagsProps) {
  const [tags, setTags] = useState<IntentionSelection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customText, setCustomText] = useState("");
  const [fetchKey, setFetchKey] = useState("");

  const windowComplete =
    placementWindow.startTurn !== null &&
    placementWindow.endTurn !== null &&
    placementWindow.bestTurn !== null;

  const currentKey = windowComplete
    ? `${placementWindow.startTurn}-${placementWindow.endTurn}-${placementWindow.bestTurn}`
    : "";

  useEffect(() => {
    if (!windowComplete || !conversationId || currentKey === fetchKey) return;

    let cancelled = false;
    async function fetchTags() {
      setLoading(true);
      setError(null);
      try {
        const result = await getAiIntentions(
          conversationId,
          placementWindow.startTurn!,
          placementWindow.endTurn!,
          placementWindow.bestTurn!
        );
        if (!cancelled) {
          setTags(result);
          setFetchKey(currentKey);
        }
      } catch {
        if (!cancelled) {
          setError("Failed to generate suggestions. You can still type your own below.");
          setTags([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchTags();
    return () => { cancelled = true; };
  }, [conversationId, windowComplete, currentKey, fetchKey, placementWindow]);

  const handleCustomSubmit = useCallback(() => {
    if (!customText.trim()) return;
    onSelect({ tag: customText.trim(), category: "others" });
    setCustomText("");
  }, [customText, onSelect]);

  if (!windowComplete) return null;

  // Build display list: pinned tag first (always visible), then AI-generated tags (deduped)
  const seen = new Set<string>();
  const displayTags: IntentionSelection[] = [];
  if (pinnedTag) {
    displayTags.push(pinnedTag);
    seen.add(`${pinnedTag.tag}::${pinnedTag.category}`);
  }
  for (const t of tags) {
    const key = `${t.tag}::${t.category}`;
    if (seen.has(key)) continue;
    seen.add(key);
    displayTags.push(t);
  }

  // Custom "Other" is selected when selectedTag exists but isn't in the display list
  const isCustomSelected = selectedTag !== null &&
    !displayTags.some(t => t.tag === selectedTag.tag && t.category === selectedTag.category);

  return (
    <div className="space-y-3">
      {/* Tag pills — show immediately if selectedTag exists, even while loading */}
      {displayTags.length > 0 && (
        <div className="flex flex-col items-start gap-1.5">
          {displayTags.map((t, i) => {
            const styles = CATEGORY_STYLES[t.category] || CATEGORY_STYLES.others;
            const isSelected = selectedTag?.tag === t.tag && selectedTag?.category === t.category;
            return (
              <button
                key={`${t.tag}-${t.category}-${i}`}
                onClick={() => onSelect(t)}
                className={`inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium text-left transition-all ${
                  isSelected ? styles.selected : styles.hover
                }`}
              >
                {isSelected && (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                    <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
                  </svg>
                )}
                <span>{t.tag}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Loading indicator — shown alongside/below the pre-selected tag */}
      {loading && (
        <div className="flex items-center gap-2 py-1">
          <svg className="h-3.5 w-3.5 animate-spin text-indigo-500" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-xs text-gray-500">
            {selectedTag ? "Generating additional directions..." : "Generating directions..."}
          </span>
        </div>
      )}

      {!loading && error && <p className="text-xs text-amber-600">{error}</p>}

      {/* "Other" tag with inline text input */}
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium shrink-0 ${
          isCustomSelected
            ? CATEGORY_STYLES.others.selected
            : "border-gray-200 bg-white text-gray-700"
        }`}>
          Other
        </span>
        <input
          type="text"
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCustomSubmit()}
          placeholder="Type your own direction..."
          className="flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
        />
        <button
          onClick={handleCustomSubmit}
          disabled={!customText.trim()}
          className="shrink-0 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
        >
          Use
        </button>
      </div>

      {selectedTag && (
        <div className="flex items-center gap-2 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4 text-indigo-500">
            <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
          </svg>
          <span className="text-xs font-medium text-indigo-700">
            Selected: "{selectedTag.tag}"
          </span>
        </div>
      )}
    </div>
  );
}
