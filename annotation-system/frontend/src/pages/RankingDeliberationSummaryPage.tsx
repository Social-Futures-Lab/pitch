import { useState, useEffect, useMemo, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { GroupProgress } from "@/types";
import {
  getRankingDeliberationExcerpts,
  getPeerRankings,
  completeRankingDeliberation,
  getRankingDeliberationGroupProgress,
  getRankingDeliberationProgress,
} from "@/api/rankingDeliberation";
import { getDeliberationProgress } from "@/api/deliberation";

interface ExcerptSummary {
  excerpt_id: string;
  conversation_id: string;
  excerpt_start_turn: number;
  excerpt_end_turn: number;
  item_count: number;
  changed: boolean;
  original_order: string[];
  current_order: string[];
}

interface CrossAnnotationStats {
  total: number;
  revised: number;
  keptOriginal: number;
  doNotSurfaceCount: number;
}

type CompletionStatus = "idle" | "submitting" | "waiting" | "all_complete";

export default function RankingDeliberationSummaryPage() {
  const [searchParams] = useSearchParams();
  const conversationScope = searchParams.get("conversation");

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<ExcerptSummary[]>([]);
  const [completionStatus, setCompletionStatus] = useState<CompletionStatus>("idle");
  const [groupProgress, setGroupProgress] = useState<GroupProgress | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [crossAnnotationStats, setCrossAnnotationStats] = useState<CrossAnnotationStats | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const [excerptsRaw, crossProgress, rankingProgress] = await Promise.all([
          getRankingDeliberationExcerpts(),
          getDeliberationProgress().catch(() => null),
          getRankingDeliberationProgress().catch(() => null),
        ]);
        if (cancelled) return;

        if (rankingProgress?.ranking_deliberation_completed) {
          setCompletionStatus("waiting");
        }

        if (crossProgress) {
          setCrossAnnotationStats({
            total: crossProgress.total,
            revised: crossProgress.completed,
            keptOriginal: crossProgress.total - crossProgress.completed,
            doNotSurfaceCount: crossProgress.do_not_surface_count,
          });
        }

        let excerpts = excerptsRaw;

        if (conversationScope) {
          excerpts = excerpts.filter((e) => e.conversation_id === conversationScope);
        }

        const results: ExcerptSummary[] = [];
        for (const excerpt of excerpts) {
          try {
            const data = await getPeerRankings(excerpt.excerpt_id);
            if (cancelled) return;

            const originalOrder = data.original_ranking.ranked_items.map(
              (r) => r.knowledge_item_id
            );
            const currentOrder = data.own_ranking.ranked_items.map(
              (r) => r.knowledge_item_id
            );

            results.push({
              excerpt_id: excerpt.excerpt_id,
              conversation_id: excerpt.conversation_id,
              excerpt_start_turn: excerpt.excerpt_start_turn,
              excerpt_end_turn: excerpt.excerpt_end_turn,
              item_count: excerpt.item_count,
              changed: JSON.stringify(originalOrder) !== JSON.stringify(currentOrder),
              original_order: originalOrder,
              current_order: currentOrder,
            });
          } catch {
            // Skip excerpts that fail to load
          }
        }

        if (!cancelled) setSummaries(results);
      } catch {
        if (!cancelled) setLoadError("Failed to load ranking deliberation data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [conversationScope]);

  // Poll for group progress when waiting
  useEffect(() => {
    if (completionStatus !== "waiting") return;

    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const progress = await getRankingDeliberationGroupProgress();
        if (cancelled) return;
        setGroupProgress(progress);
        if (progress.all_complete) {
          setCompletionStatus("all_complete");
        }
      } catch {}
    }, 10000);

    getRankingDeliberationGroupProgress()
      .then((progress) => {
        if (!cancelled) {
          setGroupProgress(progress);
          if (progress.all_complete) {
            setCompletionStatus("all_complete");
          }
        }
      })
      .catch(() => {});

    return () => { cancelled = true; clearInterval(interval); };
  }, [completionStatus]);

  const stats = useMemo(() => {
    const total = summaries.length;
    const revised = summaries.filter((s) => s.changed).length;
    return { total, revised, keptOriginal: total - revised };
  }, [summaries]);

  const handleComplete = useCallback(async () => {
    setCompletionStatus("submitting");
    setSubmitError(null);
    try {
      await completeRankingDeliberation();
      setCompletionStatus("waiting");
    } catch {
      setSubmitError("Failed to complete ranking deliberation. Please try again.");
      setCompletionStatus("idle");
    }
  }, []);

  // Group by conversation
  const groupedSummaries = useMemo(() => {
    const groups = new Map<string, ExcerptSummary[]>();
    for (const s of summaries) {
      const existing = groups.get(s.conversation_id) ?? [];
      existing.push(s);
      groups.set(s.conversation_id, existing);
    }
    return Array.from(groups.entries());
  }, [summaries]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-3 text-gray-400">
          <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading summary...
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-red-600">{loadError}</p>
          <button onClick={() => window.location.reload()} className="mt-3 text-sm text-indigo-600 hover:underline">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const crossAnnotationSummaryPath = conversationScope
    ? `/deliberation/summary?conversation=${conversationScope}`
    : "/deliberation/summary";

  // Waiting/complete state
  if (completionStatus === "waiting" || completionStatus === "all_complete") {
    return (
      <div className="flex h-full items-center justify-center bg-gray-50 p-8">
        <div className="w-full max-w-2xl">
          <div className="text-center">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <svg className="h-10 w-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>

            <h1 className="mb-2 text-2xl font-bold text-gray-900">
              {completionStatus === "all_complete"
                ? "Everyone Has Completed"
                : "Review Complete"}
            </h1>

            {completionStatus === "all_complete" ? (
              <p className="mb-6 text-sm text-gray-600">
                All participants have completed both review stages. Your researcher/admin will advance the group to the next stage.
              </p>
            ) : (
              <p className="mb-6 text-sm text-gray-600">
                You've completed both annotation and ranking review stages.
              </p>
            )}
          </div>

          {/* Combined deliberation summary — stacked vertically */}
          <div className="mb-6 space-y-4">
            {/* Cross-annotation section */}
            <div className="rounded-lg border border-gray-200 bg-white p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700">
                  Annotation Review
                </h3>
                <Link
                  to={crossAnnotationSummaryPath}
                  className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50 hover:border-indigo-200"
                >
                  Review my decisions
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                    <path fillRule="evenodd" d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                  </svg>
                </Link>
              </div>
              {crossAnnotationStats ? (
                <div className="grid grid-cols-4 gap-4">
                  <div>
                    <p className="text-xl font-bold text-gray-900">{crossAnnotationStats.total}</p>
                    <p className="text-xs text-gray-500">Total items</p>
                  </div>
                  <div>
                    <p className="text-xl font-bold text-green-600">{crossAnnotationStats.revised}</p>
                    <p className="text-xs text-gray-500">Reviewed</p>
                  </div>
                  <div>
                    <p className="text-xl font-bold text-gray-400">{crossAnnotationStats.keptOriginal}</p>
                    <p className="text-xs text-gray-500">Kept original</p>
                  </div>
                  <div>
                    <p className="text-xl font-bold text-red-500">{crossAnnotationStats.doNotSurfaceCount}</p>
                    <p className="text-xs text-gray-500">Should not appear</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-400">Completed</p>
              )}
            </div>

            {/* Ranking section */}
            <div className="rounded-lg border border-gray-200 bg-white p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700">
                  Ranking Review
                </h3>
                <Link
                  to={summaries.length > 0
                    ? `/ranking-deliberation/${summaries[0].excerpt_id}${conversationScope ? `?conversation=${conversationScope}` : ""}`
                    : "#"
                  }
                  className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50 hover:border-indigo-200"
                >
                  Review my decisions
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                    <path fillRule="evenodd" d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                  </svg>
                </Link>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-xl font-bold text-gray-900">{stats.total}</p>
                  <p className="text-xs text-gray-500">Total excerpts</p>
                </div>
                <div>
                  <p className="text-xl font-bold text-amber-600">{stats.revised}</p>
                  <p className="text-xs text-gray-500">Revised</p>
                </div>
                <div>
                  <p className="text-xl font-bold text-green-600">{stats.keptOriginal}</p>
                  <p className="text-xs text-gray-500">Kept original</p>
                </div>
              </div>
            </div>
          </div>

          {completionStatus === "waiting" && groupProgress && groupProgress.participants && (
            <div className="mb-6 rounded-lg border border-gray-200 bg-white p-6">
              <h2 className="mb-4 text-sm font-semibold text-gray-700">
                Waiting for Other Participants
              </h2>
              <ul className="space-y-2">
                {groupProgress.participants.map((participant) => (
                  <li key={participant.user_id} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700">
                      {participant.is_current_user ? (
                        <>{participant.user_name} <span className="text-gray-400">(You)</span></>
                      ) : (
                        participant.user_name
                      )}
                    </span>
                    <span className={`flex items-center gap-1.5 ${
                      participant.completed ? "text-green-600" : "text-gray-400"
                    }`}>
                      {participant.completed ? (
                        <>
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Complete
                        </>
                      ) : (
                        <>
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          In progress
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-center text-sm font-semibold text-gray-700">
                {groupProgress.completed_count} of {groupProgress.total_participants} participants complete
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-gray-200 bg-white px-6 py-4">
        <h1 className="text-2xl font-bold text-gray-900">
          Review Your Ranking Decisions
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Review all {stats.total} excerpts before completing
        </p>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto bg-gray-50 p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          {/* Stats card */}
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">
              Summary Statistics
            </h2>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
                <p className="text-sm text-gray-500">Total excerpts</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-amber-600">{stats.revised}</p>
                <p className="text-sm text-gray-500">Rankings revised</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-green-600">{stats.keptOriginal}</p>
                <p className="text-sm text-gray-500">Kept original</p>
              </div>
            </div>
          </div>

          {/* Decisions list */}
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">
              Decisions by Conversation
            </h2>
            <div className="space-y-6">
              {groupedSummaries.map(([conversationId, convSummaries]) => (
                <div key={conversationId}>
                  <h3 className="mb-3 text-sm font-semibold text-gray-700">
                    Conversation {conversationId.substring(0, 8)} ({convSummaries.length} excerpt{convSummaries.length !== 1 ? "s" : ""})
                  </h3>
                  <div className="space-y-3">
                    {convSummaries.map((summary) => (
                      <div
                        key={summary.excerpt_id}
                        className={`rounded-md border-l-4 border-gray-200 bg-gray-50 p-4 ${
                          summary.changed ? "border-l-amber-500" : "border-l-green-500"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-700">
                              Turns #{summary.excerpt_start_turn}–#{summary.excerpt_end_turn}
                            </p>
                            <p className="mt-1 text-xs text-gray-500">
                              {summary.item_count} item{summary.item_count !== 1 ? "s" : ""} —{" "}
                              {summary.changed ? "Ranking revised" : "Kept original ranking"}
                            </p>
                          </div>
                          <Link
                            to={`/ranking-deliberation/${summary.excerpt_id}${conversationScope ? `?conversation=${conversationScope}` : ""}`}
                            className="shrink-0 text-xs font-medium text-indigo-600 hover:underline"
                          >
                            Review Decision →
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
          <Link
            to={crossAnnotationSummaryPath}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
              <path fillRule="evenodd" d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
            </svg>
            Annotation Summary
          </Link>

          <div className="flex items-center gap-3">
            {submitError && <p className="text-sm text-red-600">{submitError}</p>}

            <button
              onClick={handleComplete}
              disabled={completionStatus === "submitting"}
              className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {completionStatus === "submitting" ? "Completing..." : "Complete Ranking Review"}
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                <path fillRule="evenodd" d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
