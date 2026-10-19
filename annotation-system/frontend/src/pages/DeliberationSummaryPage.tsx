import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import type { Assignment, Annotation } from "@/types";
import { getAssignments, getAnnotationDoneProgress, getExcerptDetail } from "@/api/annotation";
import {
  getMyOriginal,
  getPeerAnnotations,
  completeDeliberation,
} from "@/api/deliberation";
import { PERTINENCE_LABELS } from "@/constants";

type ChangeType =
  | "unchanged"
  | "window_adjusted"
  | "marked_do_not_surface"
  | "unmarked_do_not_surface"
  | "new_placement";

interface DecisionSummary {
  excerptId: string;
  knowledgeItemId: string;
  conversationId: string;
  excerptRange: string;
  messagePreview: string;
  originalWindow: string | null;
  originalBest: number | null;
  originalDoNotSurface: boolean;
  originalContributionType: string | null;
  originalPertinence: number | null;
  deliberationWindow: string | null;
  deliberationBest: number | null;
  deliberationDoNotSurface: boolean;
  deliberationContributionType: string | null;
  deliberationPertinence: number | null;
  changeType: ChangeType;
  changeDescription: string;
}

type CompletionStatus = "idle" | "submitting" | "waiting" | "all_complete";

export default function DeliberationSummaryPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const conversationScope = searchParams.get("conversation");
  const backPath = conversationScope ? "/my-groups" : "/deliberation";

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [decisions, setDecisions] = useState<DecisionSummary[]>([]);
  const [completionStatus, setCompletionStatus] = useState<CompletionStatus>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);

  // --- Load data ---
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const allAssignData = await getAssignments();
        if (cancelled) return;

        const assignData = conversationScope
          ? allAssignData.filter((a) => a.conversation_id === conversationScope)
          : allAssignData;

        setAssignments(assignData);

        // Fetch original and deliberation annotations for all assignments
        const summaries: DecisionSummary[] = [];
        for (const assignment of assignData) {
          try {
            const [latestData, peersData, excerptData] = await Promise.all([
              getMyOriginal(assignment.excerpt_id, assignment.knowledge_item_id),
              getPeerAnnotations(assignment.excerpt_id, assignment.knowledge_item_id),
              getExcerptDetail(assignment.excerpt_id),
            ]);

            const original = peersData.own_annotation;
            const deliberation = latestData;

            // Calculate change type
            let changeType: ChangeType = "unchanged";
            let changeDescription = "No change made";

            const originalWasPlaced = !original.do_not_surface;
            const deliberationIsPlaced = !deliberation.do_not_surface;

            if (!originalWasPlaced && deliberationIsPlaced) {
              changeType = "unmarked_do_not_surface";
              changeDescription = "Changed from should not appear to placed";
            } else if (originalWasPlaced && !deliberationIsPlaced) {
              changeType = "marked_do_not_surface";
              changeDescription = "Marked as should not appear";
            } else if (originalWasPlaced && deliberationIsPlaced) {
              // Both placed - check if window changed
              const windowChanged =
                original.window_start_turn_number !== deliberation.window_start_turn_number ||
                original.window_end_turn_number !== deliberation.window_end_turn_number ||
                original.best_turn_number !== deliberation.best_turn_number;

              if (windowChanged) {
                changeType = "window_adjusted";
                if (
                  deliberation.window_start_turn_number !== null &&
                  original.window_start_turn_number !== null &&
                  deliberation.window_end_turn_number !== null &&
                  original.window_end_turn_number !== null
                ) {
                  const origRange = original.window_end_turn_number - original.window_start_turn_number;
                  const newRange = deliberation.window_end_turn_number - deliberation.window_start_turn_number;
                  if (newRange < origRange) {
                    changeDescription = "Narrowed window";
                  } else if (newRange > origRange) {
                    changeDescription = "Expanded window";
                  } else {
                    changeDescription = "Shifted window";
                  }
                }
              }
            }

            const originalWindow = original.do_not_surface
              ? null
              : original.window_start_turn_number !== null && original.window_end_turn_number !== null
              ? `#${original.window_start_turn_number}-#${original.window_end_turn_number}`
              : null;

            const deliberationWindow = deliberation.do_not_surface
              ? null
              : deliberation.window_start_turn_number !== null && deliberation.window_end_turn_number !== null
              ? `#${deliberation.window_start_turn_number}-#${deliberation.window_end_turn_number}`
              : null;

            summaries.push({
              excerptId: assignment.excerpt_id,
              knowledgeItemId: assignment.knowledge_item_id,
              conversationId: assignment.conversation_id,
              excerptRange: `Turns #${assignment.excerpt_start_turn}-#${assignment.excerpt_end_turn}`,
              messagePreview: excerptData.knowledge_item.neutralized_ideal_response,
              originalWindow,
              originalBest: original.best_turn_number,
              originalDoNotSurface: original.do_not_surface,
              originalContributionType: original.contribution_type,
              originalPertinence: original.pertinence,
              deliberationWindow,
              deliberationBest: deliberation.best_turn_number,
              deliberationDoNotSurface: deliberation.do_not_surface,
              deliberationContributionType: deliberation.contribution_type,
              deliberationPertinence: deliberation.pertinence,
              changeType,
              changeDescription,
            });
          } catch {
            // If we can't fetch data for this assignment, skip it
          }
        }

        if (cancelled) return;
        setDecisions(summaries);
      } catch {
        if (!cancelled) setLoadError("Failed to load deliberation data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Poll group status to detect admin advancing the phase ---
  useEffect(() => {
    if (!conversationScope) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const dp = await getAnnotationDoneProgress(conversationScope);
        if (cancelled) return;
        if (dp.group_status === "complete") {
          navigate("/my-groups");
        }
      } catch { /* ignore */ }
    }, 10000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [conversationScope, navigate]);

  // --- Group by conversation ---
  const groupedDecisions = useMemo(() => {
    // First, sort all decisions to match the prev/next navigation order
    const sortedDecisions = [...decisions].sort((a, b) => {
      // Sort by conversation_id, then excerpt_id, then knowledge_item_id
      if (a.conversationId !== b.conversationId) {
        return a.conversationId.localeCompare(b.conversationId);
      }
      if (a.excerptId !== b.excerptId) {
        return a.excerptId.localeCompare(b.excerptId);
      }
      return a.knowledgeItemId.localeCompare(b.knowledgeItemId);
    });

    // Then group them (they'll already be in the right order)
    const groups = new Map<string, DecisionSummary[]>();
    for (const decision of sortedDecisions) {
      const existing = groups.get(decision.conversationId) || [];
      existing.push(decision);
      groups.set(decision.conversationId, existing);
    }
    return Array.from(groups.entries());
  }, [decisions]);

  // --- Stats ---
  const stats = useMemo(() => {
    const total = decisions.length;
    const revised = decisions.filter((d) => d.changeType !== "unchanged").length;
    const keptOriginal = total - revised;
    const markedDoNotSurface = decisions.filter((d) => d.changeType === "marked_do_not_surface").length;
    return { total, revised, keptOriginal, markedDoNotSurface };
  }, [decisions]);

  // --- Complete deliberation ---
  const handleComplete = useCallback(async () => {
    setCompletionStatus("submitting");
    setSubmitError(null);
    try {
      await completeDeliberation();
      // Navigate to ranking deliberation
      const rankingPath = conversationScope
        ? `/ranking-deliberation?conversation=${conversationScope}`
        : "/ranking-deliberation";
      navigate(rankingPath);
    } catch {
      setSubmitError("Failed to complete deliberation. Please try again.");
      setCompletionStatus("idle");
    }
  }, [conversationScope, navigate]);

  // --- Get border color for change type ---
  const getBorderColor = (changeType: ChangeType): string => {
    if (changeType === "unchanged") return "border-l-gray-300";
    return "border-l-orange-500";
  };

  // --- Loading state ---
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-3 text-gray-400">
          <svg
            className="h-5 w-5 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          Loading summary...
        </div>
      </div>
    );
  }

  // --- Error state ---
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

  // --- Empty state ---
  if (decisions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">You haven't reviewed any messages yet.</p>
          <p className="mt-1 text-sm text-gray-400">
            Start by selecting a message from the list.
          </p>
          <Link
            to={backPath}
            className="mt-4 inline-block text-sm font-medium text-indigo-600 hover:underline"
          >
            {conversationScope ? "Back to My Groups" : "Go to deliberation list"}
          </Link>
        </div>
      </div>
    );
  }

  // --- Main summary view ---
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-gray-200 bg-white px-6 py-4">
        <h1 className="text-2xl font-bold text-gray-900">
          Review Your Decisions
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Review all {stats.total} messages before completing
        </p>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto bg-gray-50 p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          {/* Progress stats card */}
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">
              Summary Statistics
            </h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div>
                <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
                <p className="text-sm text-gray-500">Total messages</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-amber-600">{stats.revised}</p>
                <p className="text-sm text-gray-500">Revised</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-green-600">{stats.keptOriginal}</p>
                <p className="text-sm text-gray-500">No change made</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-red-600">{stats.markedDoNotSurface}</p>
                <p className="text-sm text-gray-500">Should not appear</p>
              </div>
            </div>
          </div>

          {/* Decisions list grouped by conversation */}
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">
              Decisions Detail
            </h2>
            <div className="space-y-6">
              {groupedDecisions.map(([conversationId, conversationDecisions]) => (
                <div key={conversationId}>
                  <h3 className="mb-3 text-sm font-semibold text-gray-700">
                    Conversation {conversationId.substring(0, 8)} ({conversationDecisions.length} messages)
                  </h3>
                  <div className="space-y-3">
                    {conversationDecisions.map((decision) => (
                      <div
                        key={`${decision.excerptId}-${decision.knowledgeItemId}`}
                        className={`rounded-md border-l-4 border-gray-200 bg-gray-50 p-4 ${getBorderColor(decision.changeType)}`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm italic text-gray-600 line-clamp-2 border-l-2 border-gray-300 pl-2">
                              "{decision.messagePreview}"
                            </p>
                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                              {decision.deliberationDoNotSurface ? (
                                <span className="font-medium text-gray-700">
                                  Should not appear
                                  {!decision.originalDoNotSurface && (
                                    <span className="ml-1 text-amber-600">(was: placed)</span>
                                  )}
                                </span>
                              ) : (
                                <>
                                  <span>
                                    <span className="font-medium text-gray-700">Window:</span>{" "}
                                    {decision.deliberationWindow}
                                    {decision.originalWindow !== null && decision.originalWindow !== decision.deliberationWindow && (
                                      <span className="ml-1 text-amber-600">(was: {decision.originalWindow})</span>
                                    )}
                                  </span>
                                  {decision.deliberationBest !== null && (
                                    <span>
                                      <span className="font-medium text-gray-700">Best turn:</span>{" "}
                                      #{decision.deliberationBest}
                                      {decision.originalBest !== null && decision.originalBest !== decision.deliberationBest && (
                                        <span className="ml-1 text-amber-600">(was: #{decision.originalBest})</span>
                                      )}
                                    </span>
                                  )}
                                  {decision.deliberationPertinence !== null && decision.deliberationPertinence !== undefined && (
                                    <span>
                                      <span className="font-medium text-gray-700">Importance:</span>{" "}
                                      {PERTINENCE_LABELS[decision.deliberationPertinence] || `${decision.deliberationPertinence}`}
                                      {decision.originalPertinence !== null && decision.originalPertinence !== undefined && decision.originalPertinence !== decision.deliberationPertinence && (
                                        <span className="ml-1 text-amber-600">(was: {PERTINENCE_LABELS[decision.originalPertinence] || `${decision.originalPertinence}`})</span>
                                      )}
                                    </span>
                                  )}
                                </>
                              )}
                            </div>
                            <p className="mt-1.5 text-xs text-gray-500">
                              Change: {decision.changeDescription}
                            </p>
                          </div>
                          <Link
                            to={`/deliberation/${decision.excerptId}?knowledge_item_id=${decision.knowledgeItemId}${conversationScope ? `&conversation=${conversationScope}` : ""}`}
                            className="shrink-0 text-xs font-medium text-indigo-600 hover:underline"
                          >
                            Review →
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="shrink-0 border-t border-gray-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          {conversationScope ? (
            <div />
          ) : (
            <Link
              to={backPath}
              className="inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                fill="currentColor"
                className="h-3.5 w-3.5"
              >
                <path
                  fillRule="evenodd"
                  d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z"
                  clipRule="evenodd"
                />
              </svg>
              Go Back to List
            </Link>
          )}

          <div className="flex items-center gap-3">
            {submitError && (
              <p className="text-sm text-red-600">{submitError}</p>
            )}

            <button
              onClick={handleComplete}
              disabled={completionStatus === "submitting"}
              className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {completionStatus === "submitting" ? "Proceeding..." : "Proceed to Ranking Review"}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                fill="currentColor"
                className="h-3.5 w-3.5"
              >
                <path
                  fillRule="evenodd"
                  d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
