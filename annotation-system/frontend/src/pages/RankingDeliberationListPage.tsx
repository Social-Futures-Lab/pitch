import { useState, useEffect, useCallback } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import {
  getRankingDeliberationExcerpts,
  getRankingDeliberationProgress,
  type RankingDeliberationExcerpt,
  type RankingDeliberationProgress,
} from "@/api/rankingDeliberation";

function ConversationRedirect({ conversationId }: { conversationId: string }) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function resolve() {
      try {
        const [excerpts, progress] = await Promise.all([
          getRankingDeliberationExcerpts(),
          getRankingDeliberationProgress(),
        ]);
        if (cancelled) return;

        // If ranking deliberation is already complete, still allow access to adjust ranking

        const convExcerpts = excerpts.filter(
          (e) => e.conversation_id === conversationId
        );

        if (convExcerpts.length === 0) {
          setError("No ranking deliberation items found for this conversation.");
          return;
        }

        const first = convExcerpts[0];
        navigate(
          `/ranking-deliberation/${first.excerpt_id}?conversation=${conversationId}`,
          { replace: true }
        );
      } catch {
        if (!cancelled) setError("Failed to load ranking deliberation data.");
      }
    }
    resolve();
    return () => { cancelled = true; };
  }, [conversationId, navigate]);

  if (error) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-red-600">{error}</p>
          <Link to="/my-groups" className="mt-3 inline-block text-sm text-indigo-600 hover:underline">
            Back to My Groups
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-64 items-center justify-center">
      <div className="text-sm text-gray-400">Loading ranking deliberation...</div>
    </div>
  );
}

export default function RankingDeliberationListPage() {
  const [searchParams] = useSearchParams();
  const conversationId = searchParams.get("conversation");

  if (conversationId) {
    return <ConversationRedirect conversationId={conversationId} />;
  }

  return <RankingDeliberationListView />;
}

function RankingDeliberationListView() {
  const [excerpts, setExcerpts] = useState<RankingDeliberationExcerpt[]>([]);
  const [progress, setProgress] = useState<RankingDeliberationProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [excerptData, progressData] = await Promise.all([
        getRankingDeliberationExcerpts(),
        getRankingDeliberationProgress(),
      ]);
      setExcerpts(excerptData);
      setProgress(progressData);
    } catch {
      setError("Failed to load ranking deliberation data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-sm text-gray-400">Loading ranking deliberation...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-red-600">{error}</p>
          <button onClick={() => window.location.reload()} className="mt-3 text-sm text-indigo-600 hover:underline">
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Group by conversation
  const conversationGroups = new Map<string, RankingDeliberationExcerpt[]>();
  for (const e of excerpts) {
    const existing = conversationGroups.get(e.conversation_id) ?? [];
    existing.push(e);
    conversationGroups.set(e.conversation_id, existing);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Ranking Review</h1>
        <p className="mt-1 text-sm text-gray-500">
          Review other participants' rankings and optionally revise your own ranking.
        </p>
        <Link
          to="/deliberation"
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
        >
          ← Back to Review & Revise
        </Link>
      </div>

      {progress && (
        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium text-gray-700">Overall Progress</span>
            <span className="text-gray-500">
              {progress.completed} of {progress.total} excerpts reviewed (
              {progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0}%)
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all duration-300"
              style={{ width: `${progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0}%` }}
            />
          </div>
        </div>
      )}

      {progress && progress.total > 0 && progress.completed === progress.total && (
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="shrink-0 rounded-full bg-green-100 p-2">
              <svg className="h-5 w-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-green-800">
                All ranking reviews complete
              </h3>
              <p className="mt-1 text-sm text-green-700">
                You've reviewed all {progress.total} excerpts. You can proceed to the summary to finalize.
              </p>
              <Link
                to="/ranking-deliberation/summary"
                className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-green-800 hover:underline"
              >
                Go to Summary →
              </Link>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-6">
        {Array.from(conversationGroups.entries()).map(([conversationId, convExcerpts]) => {
          const reviewedCount = convExcerpts.filter((e) => e.revised).length;

          return (
            <div key={conversationId} className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-800">Conversation</span>
                  <span className="font-mono text-xs text-gray-500">{conversationId.slice(0, 8)}</span>
                </div>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    reviewedCount === convExcerpts.length
                      ? "bg-green-100 text-green-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {reviewedCount}/{convExcerpts.length} revised
                </span>
              </div>

              <div className="divide-y divide-gray-100">
                {convExcerpts.map((excerpt) => (
                  <Link
                    key={excerpt.excerpt_id}
                    to={`/ranking-deliberation/${excerpt.excerpt_id}`}
                    className={`flex items-center justify-between px-4 py-3 transition-colors hover:bg-gray-50 ${
                      excerpt.revised ? "bg-green-50/30" : ""
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-700">
                        Turns {excerpt.excerpt_start_turn}–{excerpt.excerpt_end_turn}
                      </span>
                      <span className="text-xs text-gray-400">
                        {excerpt.item_count} item{excerpt.item_count !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        excerpt.revised
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-500"
                      }`}>
                        {excerpt.revised ? "Revised" : "Pending"}
                      </span>
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4 text-gray-400">
                        <path fillRule="evenodd" d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                      </svg>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {conversationGroups.size === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <p className="text-sm text-gray-500">No ranking deliberation items found.</p>
        </div>
      )}
    </div>
  );
}
