import { useState, useCallback } from "react";
import { aiSourceSearch } from "@/api/construction";
import type { PlacementWindow } from "@/components/construction/TranscriptReview";
import type { SearchResult } from "@/types";

interface InsertedResource {
  id: string;
  title: string;
  snippet?: string;
  url?: string;
  source: "scholar" | "web" | "manual";
}

export interface AISourceFinderState {
  results: SearchResult[];
  queriesUsed: string[];
  searched: boolean;
  error: string | null;
}

export function emptyAISourceFinderState(): AISourceFinderState {
  return { results: [], queriesUsed: [], searched: false, error: null };
}

interface AISourceFinderProps {
  conversationId: string;
  window: PlacementWindow;
  intentionTag: string;
  contributionType: string;
  onInsertResource: (resource: InsertedResource) => void;
  insertedResourceIds: Set<string>;
  state: AISourceFinderState;
  onStateChange: (state: AISourceFinderState) => void;
}

export default function AISourceFinder({
  conversationId,
  window: placementWindow,
  intentionTag,
  contributionType,
  onInsertResource,
  insertedResourceIds,
  state,
  onStateChange,
}: AISourceFinderProps) {
  const { results, queriesUsed, searched, error } = state;
  const [loading, setLoading] = useState(false);
  const [showQueries, setShowQueries] = useState(false);

  const handleSearch = useCallback(async () => {
    if (!conversationId || !placementWindow.startTurn || !placementWindow.endTurn || !placementWindow.bestTurn) return;

    setLoading(true);
    onStateChange({ ...state, error: null });
    try {
      const data = await aiSourceSearch(
        conversationId,
        placementWindow.startTurn,
        placementWindow.endTurn,
        placementWindow.bestTurn,
        intentionTag,
        contributionType
      );
      onStateChange({ results: data.results, queriesUsed: data.queries_used, searched: true, error: null });
    } catch {
      onStateChange({ ...state, error: "AI source search failed. Try using Scholar or Web search instead.", results: [], searched: true });
    } finally {
      setLoading(false);
    }
  }, [conversationId, placementWindow, intentionTag, contributionType, state, onStateChange]);

  const handleInsert = useCallback((result: SearchResult) => {
    const resource: InsertedResource = {
      id: result.id,
      title: result.result_title || result.query,
      snippet: result.result_snippet || undefined,
      url: result.result_url || undefined,
      source: result.result_metadata?.authors ? "scholar" : "web",
    };
    onInsertResource(resource);
  }, [onInsertResource]);

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-600">
        AI will analyze the conversation and your selected direction to find relevant sources automatically.
      </p>

      <button
        onClick={handleSearch}
        disabled={loading}
        className="w-full rounded-md bg-violet-600 px-3 py-2 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-50 transition-colors"
      >
        {loading ? (
          <span className="inline-flex items-center gap-2">
            <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Finding sources...
          </span>
        ) : searched ? (
          "Search Again"
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
              <path d="M15.98 1.804a1 1 0 00-1.96 0l-.24 1.192a1 1 0 01-.784.784l-1.192.24a1 1 0 000 1.96l1.192.24a1 1 0 01.784.784l.24 1.192a1 1 0 001.96 0l.24-1.192a1 1 0 01.784-.784l1.192-.24a1 1 0 000-1.96l-1.192-.24a1 1 0 01-.784-.784l-.24-1.192zM5.98 7.804a1 1 0 00-1.96 0l-.24 1.192a1 1 0 01-.784.785l-1.192.24a1 1 0 000 1.958l1.192.24a1 1 0 01.784.785l.24 1.192a1 1 0 001.96 0l.24-1.192a1 1 0 01.784-.785l1.192-.24a1 1 0 000-1.958l-1.192-.24a1 1 0 01-.784-.785l-.24-1.192z" />
            </svg>
            Find Sources with AI
          </span>
        )}
      </button>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {queriesUsed.length > 0 && (
        <div>
          <button
            onClick={() => setShowQueries(!showQueries)}
            className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              fill="currentColor"
              className={`h-3 w-3 transition-transform ${showQueries ? "rotate-90" : ""}`}
            >
              <path fillRule="evenodd" d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
            </svg>
            {queriesUsed.length} queries used
          </button>
          {showQueries && (
            <div className="mt-1 rounded-md bg-gray-50 border border-gray-200 p-2 space-y-0.5">
              {queriesUsed.map((q, i) => (
                <p key={i} className="text-xs text-gray-600 italic">"{q}"</p>
              ))}
            </div>
          )}
        </div>
      )}

      {searched && results.length === 0 && !loading && (
        <p className="text-xs text-gray-500 italic">No relevant sources found. Try Scholar or Web search manually.</p>
      )}

      {results.length > 0 && (
        <div className="max-h-64 overflow-y-auto space-y-1.5">
          {results.map((r) => {
            const meta = r.result_metadata ?? {};
            const authors = (meta.authors as string[] | undefined) ?? [];
            const year = meta.year as number | undefined;
            const citations = meta.citation_count as number | undefined;
            const tldr = (meta.tldr as string | undefined) || "";
            const isInserted = insertedResourceIds.has(r.id);
            return (
              <div key={r.id} className="rounded-md border border-gray-200 bg-white px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-gray-800">{r.result_title || r.query}</p>
                  {authors.length > 0 && (
                    <p className="mt-0.5 text-xs text-gray-600">
                      {authors.slice(0, 3).join(", ")}{authors.length > 3 && " et al."}
                    </p>
                  )}
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-gray-400">
                    {year && <span>{year}</span>}
                    {citations !== undefined && <span>{citations} citations</span>}
                  </div>
                  {tldr ? (
                    <p className="mt-1 text-xs text-gray-700 italic">{tldr}</p>
                  ) : r.result_snippet ? (
                    <p className="mt-1 text-xs text-gray-500 line-clamp-3">{r.result_snippet}</p>
                  ) : null}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={() => handleInsert(r)}
                    disabled={isInserted}
                    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      isInserted
                        ? "bg-green-100 text-green-700 border border-green-300 cursor-not-allowed"
                        : "bg-indigo-600 text-white hover:bg-indigo-500 shadow-sm"
                    }`}
                  >
                    {isInserted ? (
                      <>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                          <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
                        </svg>
                        Inserted
                      </>
                    ) : (
                      <>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                          <path d="M8.75 3.75a.75.75 0 0 0-1.5 0v3.5h-3.5a.75.75 0 0 0 0 1.5h3.5v3.5a.75.75 0 0 0 1.5 0v-3.5h3.5a.75.75 0 0 0 0-1.5h-3.5v-3.5Z" />
                        </svg>
                        Add Source
                      </>
                    )}
                  </button>
                  {r.result_url && (
                    <button
                      onClick={() => window.open(r.result_url!, "_blank", "noopener,noreferrer")}
                      className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50 hover:text-gray-800 transition-colors"
                      title="Open in new tab"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                        <path fillRule="evenodd" d="M4.22 11.78a.75.75 0 0 1 0-1.06L9.44 5.5H5.75a.75.75 0 0 1 0-1.5h5.5a.75.75 0 0 1 .75.75v5.5a.75.75 0 0 1-1.5 0V6.56l-5.22 5.22a.75.75 0 0 1-1.06 0Z" clipRule="evenodd" />
                      </svg>
                      Open
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
