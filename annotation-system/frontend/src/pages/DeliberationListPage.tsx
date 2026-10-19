import { useState, useEffect, useCallback } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import type { Annotation } from "@/types";
import { getMyAnnotationsForExcerpt } from "@/api/annotation";
import {
  getDeliberationProgress,
  getDeliberationAssignments,
  type DeliberationProgress,
  type DeliberationAssignment
} from "@/api/deliberation";

function ConversationRedirect({ conversationId }: { conversationId: string }) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function resolve() {
      try {
        const assignments = await getDeliberationAssignments();
        if (cancelled) return;

        const convAssignments = assignments.filter(
          (a) => a.conversation_id === conversationId
        );

        if (convAssignments.length === 0) {
          setError("No deliberation items found for this conversation.");
          return;
        }

        // Navigate to the first item
        const first = convAssignments[0];
        navigate(
          `/deliberation/${first.excerpt_id}?knowledge_item_id=${first.knowledge_item_id}&conversation=${conversationId}`,
          { replace: true }
        );
      } catch {
        if (!cancelled) setError("Failed to load deliberation assignments.");
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
      <div className="text-sm text-gray-400">Loading deliberation items...</div>
    </div>
  );
}

export default function DeliberationListPage() {
  const [searchParams] = useSearchParams();
  const conversationId = searchParams.get("conversation");

  if (conversationId) {
    return <ConversationRedirect conversationId={conversationId} />;
  }

  return <DeliberationListView />;
}

function DeliberationListView() {
  const [assignments, setAssignments] = useState<DeliberationAssignment[]>([]);
  const [annotations, setAnnotations] = useState<Map<string, Annotation[]>>(new Map());
  const [progress, setProgress] = useState<DeliberationProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [assignData, progressData] = await Promise.all([
        getDeliberationAssignments(),
        getDeliberationProgress(),
      ]);
      setAssignments(assignData);
      setProgress(progressData);

      const excerptIds = [...new Set(assignData.map((a) => a.excerpt_id))];
      const allAnns = await Promise.all(
        excerptIds.map((eid) => getMyAnnotationsForExcerpt(eid))
      );
      const annMap = new Map<string, Annotation[]>();
      for (let i = 0; i < excerptIds.length; i++) {
        annMap.set(excerptIds[i], allAnns[i]);
      }
      setAnnotations(annMap);
    } catch {
      setError("Failed to load deliberation data.");
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
        <div className="text-sm text-gray-400">Loading deliberation items...</div>
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
  const conversationGroups = new Map<string, Map<string, Assignment[]>>();
  for (const a of assignments) {
    if (!conversationGroups.has(a.conversation_id)) {
      conversationGroups.set(a.conversation_id, new Map());
    }
    const excerptMap = conversationGroups.get(a.conversation_id)!;
    const existing = excerptMap.get(a.excerpt_id) ?? [];
    existing.push(a);
    excerptMap.set(a.excerpt_id, existing);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Review & Revise</h1>
        <p className="mt-1 text-sm text-gray-500">
          Review other participants' placements and optionally revise your own annotations.
        </p>
        <Link
          to="/ranking-deliberation"
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
        >
          Go to Ranking Review →
        </Link>
      </div>

      {progress && (
        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium text-gray-700">Overall Progress</span>
            <span className="text-gray-500">
              {progress.completed} of {progress.total} items reviewed (
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
                All reviews complete
              </h3>
              <p className="mt-1 text-sm text-green-700">
                You've reviewed all {progress.total} items. You can still revise any of your reviews below if you'd like to make changes.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-6">
        {Array.from(conversationGroups.entries()).map(([conversationId, excerptMap]) => {
          const allExcerpts = Array.from(excerptMap.entries());
          const allConvAssignments = allExcerpts.flatMap(([, a]) => a);
          const reviewedCount = allConvAssignments.filter(
            (a) => progress?.revised_knowledge_item_ids.includes(a.knowledge_item_id)
          ).length;

          return (
            <div key={conversationId} className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-800">Conversation</span>
                  <span className="font-mono text-xs text-gray-500">{conversationId.slice(0, 8)}</span>
                </div>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    reviewedCount === allConvAssignments.length
                      ? "bg-green-100 text-green-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {reviewedCount}/{allConvAssignments.length} reviewed
                </span>
              </div>

              <div className="divide-y divide-gray-100">
                {allExcerpts.map(([excerptId, excerptAssignments]) => {
                  const excerptAnns = annotations.get(excerptId) ?? [];

                  return (
                    <div key={excerptId} className="px-4 py-3">
                      <p className="text-xs font-medium text-gray-500 mb-2">
                        Excerpt <span className="font-mono">{excerptId.slice(0, 8)}</span>
                        {" — "}
                        Turns {excerptAssignments[0]?.excerpt_start_turn}–{excerptAssignments[0]?.excerpt_end_turn}
                      </p>
                      <div className="space-y-1.5">
                        {excerptAssignments.map((a, itemIdx) => {
                          const ann = excerptAnns.find((an) => an.knowledge_item_id === a.knowledge_item_id);
                          const isReviewed = progress?.revised_knowledge_item_ids.includes(a.knowledge_item_id) ?? false;

                          return (
                            <Link
                              key={a.knowledge_item_id}
                              to={`/deliberation/${excerptId}?knowledge_item_id=${a.knowledge_item_id}`}
                              className={`flex items-center justify-between rounded-md border px-3 py-2 transition-colors hover:border-indigo-300 ${
                                isReviewed ? "border-green-200 bg-green-50/30" : "border-gray-200 bg-white"
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-gray-700">
                                  Item {itemIdx + 1}
                                </span>
                                {ann && !ann.do_not_surface && ann.best_turn_number !== null && (
                                  <span className="text-xs text-gray-400">
                                    Your best turn: #{ann.best_turn_number}
                                  </span>
                                )}
                                {ann?.do_not_surface && (
                                  <span className="text-xs text-gray-400">
                                    Marked as should not appear
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                  isReviewed
                                    ? "bg-green-100 text-green-700"
                                    : "bg-gray-100 text-gray-500"
                                }`}>
                                  {isReviewed ? "Reviewed" : "Pending review"}
                                </span>
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4 text-gray-400">
                                  <path fillRule="evenodd" d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                                </svg>
                              </div>
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {conversationGroups.size === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <p className="text-sm text-gray-500">No deliberation items found.</p>
        </div>
      )}
    </div>
  );
}
