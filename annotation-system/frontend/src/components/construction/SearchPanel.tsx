import { useState, useCallback } from "react";
import type { SearchResult } from "@/types";
import { searchForItem } from "@/api/construction";

interface SearchPanelProps {
  itemId: string | null;
  onInsertText?: (text: string) => void;
}

export default function SearchPanel({ itemId, onInsertText }: SearchPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleSearch = useCallback(async () => {
    if (!itemId || !query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const data = await searchForItem(itemId, query.trim());
      setResults(data);
    } catch {
      setError("Search failed. Please try again.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [itemId, query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSearch();
    }
  };

  const handleCopy = useCallback(
    (result: SearchResult) => {
      const text = result.result_snippet ?? result.result_title;
      if (onInsertText) {
        onInsertText(text);
      } else {
        navigator.clipboard.writeText(text);
      }
      setCopiedId(result.id);
      setTimeout(() => setCopiedId(null), 1500);
    },
    [onInsertText]
  );

  return (
    <div className="rounded-md border border-gray-200">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
      >
        <span className="flex items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4 text-gray-400"
          >
            <path
              fillRule="evenodd"
              d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
              clipRule="evenodd"
            />
          </svg>
          Search References
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`h-4 w-4 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-gray-200 px-4 py-3">
          {/* Search input */}
          <div className="mb-3 flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search for references..."
              disabled={!itemId}
              className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none disabled:bg-gray-100 disabled:text-gray-400"
            />
            <button
              type="button"
              onClick={handleSearch}
              disabled={loading || !itemId || !query.trim()}
              className="rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:opacity-50"
            >
              {loading ? "..." : "Search"}
            </button>
          </div>

          {!itemId && (
            <p className="text-xs text-gray-400">
              Save the item first to enable search.
            </p>
          )}

          {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

          {/* Results */}
          {results.length > 0 && (
            <ul className="space-y-2">
              {results.map((result) => (
                <li
                  key={result.id}
                  className="group rounded-md border border-gray-100 bg-gray-50 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-800 truncate">
                        {result.result_title}
                      </p>
                      {result.result_snippet && (
                        <p className="mt-0.5 text-xs leading-relaxed text-gray-500 line-clamp-3">
                          {result.result_snippet}
                        </p>
                      )}
                      {result.result_url && (
                        <a
                          href={result.result_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-block text-xs text-indigo-600 hover:text-indigo-500 hover:underline truncate max-w-full"
                        >
                          {result.result_url}
                        </a>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopy(result)}
                      title="Copy snippet to clipboard / Insert into response"
                      className="shrink-0 rounded p-1 text-gray-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-gray-200 hover:text-gray-600"
                    >
                      {copiedId === result.id ? (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          className="h-4 w-4 text-green-500"
                        >
                          <path
                            fillRule="evenodd"
                            d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                            clipRule="evenodd"
                          />
                        </svg>
                      ) : (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          className="h-4 w-4"
                        >
                          <path d="M7 3.5A1.5 1.5 0 018.5 2h3.879a1.5 1.5 0 011.06.44l3.122 3.12A1.5 1.5 0 0117 6.622V12.5a1.5 1.5 0 01-1.5 1.5h-1v-3.379a3 3 0 00-.879-2.121L10.5 5.379A3 3 0 008.379 4.5H7v-1z" />
                          <path d="M4.5 6A1.5 1.5 0 003 7.5v9A1.5 1.5 0 004.5 18h7a1.5 1.5 0 001.5-1.5v-5.879a1.5 1.5 0 00-.44-1.06L9.44 6.439A1.5 1.5 0 008.378 6H4.5z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {results.length === 0 && !loading && query.trim() && !error && (
            <p className="text-xs text-gray-400">
              No results. Try a different query.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
