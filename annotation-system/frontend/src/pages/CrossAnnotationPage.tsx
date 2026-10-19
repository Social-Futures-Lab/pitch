import { useParams, useNavigate, useSearchParams, Link } from "react-router-dom";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type {
  Assignment,
  Annotation,
  ExcerptDetail,
  AnnotationProgress,
  Conversation,
} from "@/types";
import { renderMarkdown } from "@/components/common/renderMarkdown";
import {
  getAssignments,
  getExcerptDetail,
  getMyAnnotationsForExcerpt,
  createAnnotation,
  updateAnnotation,
  submitRanking,
  getProgress,
  markAnnotationDone,
  unmarkAnnotationDone,
  getAnnotationDoneProgress,
  getRankableItems,
} from "@/api/annotation";
import { getConversation } from "@/api/conversations";
import type { CreateAnnotationData } from "@/api/annotation";
import TranscriptPanel from "@/components/annotation/TranscriptPanel";
import type { PlacementWindow, ItemMarker } from "@/components/annotation/TranscriptPanel";
import { PERTINENCE_LEVELS } from "@/constants";
import KnowledgeItemCard from "@/components/annotation/KnowledgeItemCard";
import DoNotSurfaceZone from "@/components/annotation/DoNotSurfaceZone";
import RankingPanel from "@/components/annotation/RankingPanel";
import type { RankableItem } from "@/components/annotation/RankingPanel";
import ProgressIndicator from "@/components/annotation/ProgressIndicator";
import ResizeHandle from "@/components/annotation/ResizeHandle";

// ── Assignment List View ────────────────────────────────────────────

function AssignmentListView() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [progress, setProgress] = useState<AnnotationProgress | null>(null);
  const [doneProgress, setDoneProgress] = useState<Map<string, { total: number; done: number; current_user_done: boolean }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [assignData, progressData] = await Promise.all([
        getAssignments(),
        getProgress(),
      ]);
      setAssignments(assignData);
      setProgress(progressData);

      const convIds = [...new Set(assignData.map((a) => a.conversation_id))];
      const progressMap = new Map<string, { total: number; done: number; current_user_done: boolean }>();
      await Promise.all(
        convIds.map(async (cid) => {
          try {
            const dp = await getAnnotationDoneProgress(cid);
            progressMap.set(cid, dp);
          } catch { /* ignore */ }
        })
      );
      setDoneProgress(progressMap);
    } catch {
      setError("Failed to load assignments.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [load]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-sm text-gray-400">Loading assignments...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-red-600">{error}</p>
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

  const percentage =
    progress && progress.total > 0
      ? Math.round((progress.completed / progress.total) * 100)
      : 0;

  // Group assignments by conversation_id, then by excerpt_id within each conversation
  const conversationGroups = new Map<
    string,
    Map<string, Assignment[]>
  >();
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
        <h1 className="text-2xl font-bold text-gray-900">Annotation</h1>
        <p className="mt-1 text-sm text-gray-500">
          Choose where each message could be inserted in the conversation.
        </p>
      </div>

      {/* Progress overview */}
      {progress && (
        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium text-gray-700">Overall Progress</span>
            <span className="text-gray-500">
              {progress.completed} of {progress.total} items complete (
              {percentage}%)
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all duration-300"
              style={{ width: `${percentage}%` }}
            />
          </div>
        </div>
      )}

      {/* Assignment list grouped by conversation */}
      <div className="space-y-6">
        {Array.from(conversationGroups.entries()).map(
          ([conversationId, excerptMap]) => {
            const allExcerpts = Array.from(excerptMap.entries());
            const allAssignments = allExcerpts.flatMap(([, a]) => a);
            const allComplete = allAssignments.every((a) => a.completed);
            const completedCount = allAssignments.filter((a) => a.completed).length;

            return (
              <div
                key={conversationId}
                className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden"
              >
                {/* Conversation header */}
                <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-800">
                      Conversation
                    </span>
                    <span className="font-mono text-xs text-gray-500">
                      {conversationId.slice(0, 8)}
                    </span>
                    <span className="text-xs text-gray-400">
                      {allExcerpts.length} excerpt{allExcerpts.length !== 1 && "s"},{" "}
                      {allAssignments.length} item{allAssignments.length !== 1 && "s"}
                    </span>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      allComplete
                        ? "bg-green-100 text-green-700"
                        : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {completedCount}/{allAssignments.length}
                  </span>
                </div>

                {/* Excerpts within conversation */}
                <div className="divide-y divide-gray-100">
                  {allExcerpts.map(([excerptId, excerptAssignments]) => {
                    const excAllComplete = excerptAssignments.every((a) => a.completed);
                    const excCompletedCount = excerptAssignments.filter((a) => a.completed).length;
                    const firstAssignment = excerptAssignments[0];

                    return (
                      <Link
                        key={excerptId}
                        to={`/annotation/${excerptId}`}
                        className="block px-4 py-3 transition-colors hover:bg-indigo-50/50"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-gray-700">
                              Excerpt{" "}
                              <span className="font-mono text-xs text-gray-400">
                                {excerptId.slice(0, 8)}
                              </span>
                            </p>
                            <p className="mt-0.5 text-xs text-gray-500">
                              Turns {firstAssignment.excerpt_start_turn} -{" "}
                              {firstAssignment.excerpt_end_turn}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                excAllComplete
                                  ? "bg-green-100 text-green-700"
                                  : "bg-gray-100 text-gray-600"
                              }`}
                            >
                              {excCompletedCount}/{excerptAssignments.length}
                            </span>
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 16 16"
                              fill="currentColor"
                              className="h-4 w-4 text-gray-400"
                            >
                              <path
                                fillRule="evenodd"
                                d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z"
                                clipRule="evenodd"
                              />
                            </svg>
                          </div>
                        </div>

                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {excerptAssignments.map((a, itemIdx) => (
                            <span
                              key={a.knowledge_item_id}
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                a.completed
                                  ? "bg-green-50 text-green-600"
                                  : "bg-gray-100 text-gray-500"
                              }`}
                            >
                              {a.completed && (
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  viewBox="0 0 16 16"
                                  fill="currentColor"
                                  className="h-2.5 w-2.5"
                                >
                                  <path
                                    fillRule="evenodd"
                                    d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z"
                                    clipRule="evenodd"
                                  />
                                </svg>
                              )}
                              Item {itemIdx + 1}
                            </span>
                          ))}
                        </div>
                      </Link>
                    );
                  })}
                </div>

                {/* Ranking / waiting state when all items in conversation are done */}
                {allComplete && (() => {
                  const dp = doneProgress.get(conversationId);
                  const isDone = dp?.current_user_done ?? false;

                  if (isDone) {
                    return (
                      <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
                        <div className="flex flex-col items-end gap-2">
                          <div className="flex w-full items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
                                <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                                Ranking submitted
                              </span>
                              {dp && (
                                <span className="text-xs text-gray-500">
                                  {dp.done}/{dp.total} members finished
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">Waiting for others to complete</span>
                            <Link
                              to={`/annotation/${allExcerpts[0][0]}?ranking=true`}
                              onClick={async () => {
                                try { await unmarkAnnotationDone(conversationId); } catch { /* best effort */ }
                              }}
                              className="inline-flex items-center gap-1 rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
                            >
                              Revise ranking
                            </Link>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div className="border-t border-gray-100 bg-green-50/50 px-4 py-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-green-700">
                          All items annotated. Please rank your messages.
                        </p>
                        <Link
                          to={`/annotation/${allExcerpts[0][0]}?ranking=true`}
                          className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-500 transition-colors"
                        >
                          Rank Items
                        </Link>
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          }
        )}
      </div>

      {conversationGroups.size === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <p className="text-sm text-gray-500">
            No annotation assignments found.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Ranking Waiting/Summary View ──────────────────────────────────────

function RankingWaitingView({
  conversationId,
  rankableItems,
  onEditRanking,
  advancedToDeliberation,
}: {
  conversationId: string;
  rankableItems: RankableItem[];
  onEditRanking: () => void;
  advancedToDeliberation: boolean;
}) {
  const navigate = useNavigate();
  const [groupProgress, setGroupProgress] = useState<{
    total: number;
    done: number;
    current_user_done: boolean;
    group_status: string;
  } | null>(null);
  const [localAdvanced, setLocalAdvanced] = useState(false);

  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;

    const fetchProgress = async () => {
      try {
        const progress = await getAnnotationDoneProgress(conversationId);
        if (!cancelled) {
          setGroupProgress(progress);
          if (progress.group_status === "deliberation" || progress.group_status === "complete") {
            setLocalAdvanced(true);
          }
        }
      } catch { /* ignore */ }
    };

    fetchProgress();
    const interval = setInterval(fetchProgress, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [conversationId]);

  if (advancedToDeliberation || localAdvanced) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-50 p-8">
        <div className="w-full max-w-md">
          <div className="text-center">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <svg className="h-10 w-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="mb-2 text-xl font-bold text-gray-900">Moving to Review & Revise</h1>
            <p className="mb-6 text-sm text-gray-600">
              All group members have completed their annotations and rankings.
              Your group is now ready for the review & revise stage.
            </p>
            <button
              onClick={() => navigate(`/deliberation?conversation=${conversationId}`)}
              className="rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500"
            >
              Go to Review & Revise
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-gray-50">
      <div className="shrink-0 border-b border-gray-200 bg-white px-6 py-4">
        <h1 className="text-lg font-bold text-gray-900">Ranking Submitted</h1>
        <p className="mt-1 text-sm text-gray-500">
          Waiting for other group members to complete their annotations and rankings.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {/* Group progress card */}
          {groupProgress && (
            <div className="rounded-lg border border-gray-200 bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold text-gray-700">Group Progress</h2>
              <div className="mb-3 flex items-center gap-3">
                <div className="flex-1 rounded-full bg-gray-200 h-2.5">
                  <div
                    className="h-2.5 rounded-full bg-green-500 transition-all"
                    style={{ width: `${groupProgress.total > 0 ? (groupProgress.done / groupProgress.total) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-sm font-medium text-gray-700">
                  {groupProgress.done}/{groupProgress.total}
                </span>
              </div>
              <p className="text-xs text-gray-500">
                {groupProgress.done === groupProgress.total
                  ? "All members have completed — the group will advance shortly."
                  : `${groupProgress.total - groupProgress.done} member${groupProgress.total - groupProgress.done !== 1 ? "s" : ""} still working`}
              </p>
            </div>
          )}

          {/* Your ranking summary */}
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">Your Ranking</h2>
              <button
                onClick={onEditRanking}
                className="inline-flex items-center gap-1.5 rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                  <path d="M13.488 2.513a1.75 1.75 0 0 0-2.475 0L3.05 10.476a.75.75 0 0 0-.19.333l-.97 3.407a.5.5 0 0 0 .616.617l3.407-.97a.75.75 0 0 0 .333-.19l7.964-7.963a1.75 1.75 0 0 0 0-2.475l-.722-.722ZM12.22 3.22a.25.25 0 0 1 .354 0l.722.722a.25.25 0 0 1 0 .354L5.81 11.78l-1.86.53.53-1.86 7.54-7.541.2.211Z" />
                </svg>
                Review / Edit
              </button>
            </div>

            {rankableItems.length === 0 ? (
              <p className="text-sm text-gray-400">No ranking data available.</p>
            ) : (
              <div className="space-y-2">
                {rankableItems.map((item, idx) => (
                  <div
                    key={item.knowledge_item_id}
                    className={`flex items-start gap-3 rounded-md border px-3 py-2 ${
                      item.do_not_surface
                        ? "border-gray-200 bg-gray-50 opacity-60"
                        : "border-gray-200 bg-gray-50"
                    }`}
                  >
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${
                      item.do_not_surface ? "bg-gray-400" : "bg-indigo-600"
                    }`}>
                      {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm leading-relaxed line-clamp-2 ${
                        item.do_not_surface ? "text-gray-400" : "text-gray-700"
                      }`}>
                        {item.neutralized_ideal_response}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-400">
                        After turn #{item.best_turn_number}
                        {item.do_not_surface && (
                          <span className="ml-2 text-gray-400">· should not appear</span>
                        )}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Annotation Interface View ───────────────────────────────────────

interface AnnotationState {
  annotationId: string | null;
  doNotSurface: boolean;
  pertinence: number;
  rationale: string;
  placementWindow: PlacementWindow;
}

function AnnotationInterfaceView({ excerptId }: { excerptId: string }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const conversationScope = searchParams.get("conversation");
  const backPath = conversationScope ? "/my-groups" : "/annotation";

  // Data loading state
  const [excerpt, setExcerpt] = useState<ExcerptDetail | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [allConversationAssignments, setAllConversationAssignments] = useState<Assignment[]>([]);
  const [allConversationAnnotations, setAllConversationAnnotations] = useState<Annotation[]>([]);
  const [allExcerptDetails, setAllExcerptDetails] = useState<Map<string, ExcerptDetail>>(new Map());
  const [progress, setProgress] = useState<AnnotationProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Current item navigation
  const [currentItemIndex, setCurrentItemIndex] = useState(0);

  // Per-item annotation states, keyed by knowledge_item_id
  const [annotationStates, setAnnotationStates] = useState<
    Map<string, AnnotationState>
  >(new Map());

  // Completed annotations map (for ranking)
  const [completedAnnotations, setCompletedAnnotations] = useState<
    Map<string, Annotation>
  >(new Map());

  // Turn selection mode
  const [selectingFor, setSelectingFor] = useState<import("@/components/annotation/TranscriptPanel").SelectingFor>(null);

  // Ranking mode
  const [showRanking, setShowRanking] = useState(false);
  const [showRankingWaiting, setShowRankingWaiting] = useState(false);

  // Resize handle
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [leftWidthPercent, setLeftWidthPercent] = useState(55);

  // Phase advancement detection
  const [advancedToDeliberation, setAdvancedToDeliberation] = useState(false);

  // Load data
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const [excerptData, assignData, progressData, existingAnnotations] = await Promise.all([
          getExcerptDetail(excerptId),
          getAssignments(),
          getProgress(),
          getMyAnnotationsForExcerpt(excerptId),
        ]);
        if (cancelled) return;

        setExcerpt(excerptData);
        setProgress(progressData);

        // Filter assignments for this excerpt
        const excerptAssignments = assignData.filter(
          (a) => a.excerpt_id === excerptId
        );
        setAssignments(excerptAssignments);

        // Find conversation_id from this excerpt's assignments or excerpt data
        const convId = excerptAssignments[0]?.conversation_id ?? excerptData.conversation_id;

        // Load full conversation
        if (convId) {
          const conversationData = await getConversation(convId);
          setConversation(conversationData);
        }

        // All assignments in the same conversation (for ranking)
        const convAssignments = assignData.filter((a) => a.conversation_id === convId);
        setAllConversationAssignments(convAssignments);

        // Fetch existing annotations for all excerpts in this conversation
        const excerptIds = [...new Set(convAssignments.map((a) => a.excerpt_id))];
        const allAnnotations = (
          await Promise.all(excerptIds.map((eid) => getMyAnnotationsForExcerpt(eid)))
        ).flat();
        setAllConversationAnnotations(allAnnotations);

        // Build a lookup of existing annotations by knowledge_item_id
        const existingByItem = new Map<string, Annotation>();
        for (const ann of existingAnnotations) {
          existingByItem.set(ann.knowledge_item_id, ann);
        }

        // Initialize annotation states, pre-populating from existing annotations
        const states = new Map<string, AnnotationState>();
        for (const a of excerptAssignments) {
          const existing = existingByItem.get(a.knowledge_item_id);
          if (existing) {
            states.set(a.knowledge_item_id, {
              annotationId: existing.id,
              doNotSurface: existing.do_not_surface,
              pertinence: existing.pertinence ?? -1,
              rationale: existing.rationale ?? "",
              placementWindow: {
                startTurn: existing.window_start_turn_number,
                endTurn: existing.window_end_turn_number,
                bestTurn: existing.best_turn_number,
              },
            });
          } else {
            states.set(a.knowledge_item_id, {
              annotationId: null,
              doNotSurface: false,
              pertinence: -1,
              rationale: "",
              placementWindow: {
                startTurn: null,
                endTurn: null,
                bestTurn: null,
              },
            });
          }
        }
        setAnnotationStates(states);

        // Fetch all excerpt details for the conversation (for ranking cards)
        const detailsMap = new Map<string, ExcerptDetail>();
        detailsMap.set(excerptId, excerptData);
        const otherExcerptIds = excerptIds.filter((eid) => eid !== excerptId);
        if (otherExcerptIds.length > 0) {
          const otherDetails = await Promise.all(
            otherExcerptIds.map((eid) => getExcerptDetail(eid))
          );
          for (const d of otherDetails) {
            detailsMap.set(d.id, d);
          }
        }
        setAllExcerptDetails(detailsMap);

      } catch {
        if (!cancelled) setLoadError("Failed to load excerpt data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [excerptId]);

  // Track whether we've already auto-shown the waiting screen
  const hasAutoShownWaiting = useRef(false);

  // Poll group status to detect phase advancement to deliberation
  // Also detect if user already submitted their ranking
  useEffect(() => {
    if (!excerpt?.conversation_id) return;
    let cancelled = false;
    const check = async () => {
      try {
        const dp = await getAnnotationDoneProgress(excerpt.conversation_id);
        if (cancelled) return;
        if (dp.group_status === "deliberation" || dp.group_status === "complete") {
          setAdvancedToDeliberation(true);
        }
        if (dp.current_user_done && !hasAutoShownWaiting.current) {
          hasAutoShownWaiting.current = true;
          setShowRankingWaiting(true);
        }
      } catch { /* ignore */ }
    };
    check();
    const interval = setInterval(check, 10000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [excerpt?.conversation_id]);

  // Current assignment and state
  const currentAssignment = assignments[currentItemIndex] ?? null;
  const currentKnowledgeItemId = currentAssignment?.knowledge_item_id ?? null;
  const currentState = currentKnowledgeItemId
    ? annotationStates.get(currentKnowledgeItemId) ?? null
    : null;

  // Determine item status
  const getItemStatus = useCallback(
    (knowledgeItemId: string): "placed" | "do-not-surface" | "pending" => {
      const state = annotationStates.get(knowledgeItemId);
      if (!state) return "pending";
      if (state.doNotSurface) return "do-not-surface";
      if (
        state.placementWindow.startTurn !== null &&
        state.placementWindow.endTurn !== null &&
        state.placementWindow.bestTurn !== null &&
        state.pertinence !== -1
      ) {
        return "placed";
      }
      return "pending";
    },
    [annotationStates]
  );

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Save current item
  const saveCurrentItem = useCallback(
    async (knowledgeItemId: string, state: AnnotationState) => {
      setIsSaving(true);
      setSaveError(null);
      try {
        const startTurn = state.placementWindow.startTurn;
        const endTurn = state.placementWindow.endTurn;
        const excerptStart = excerpt?.start_turn_number ?? 1;
        const excerptEnd = excerpt?.end_turn_number ?? Infinity;

        const payload: CreateAnnotationData = {
          excerpt_id: excerptId,
          knowledge_item_id: knowledgeItemId,
          window_start_turn_number: state.doNotSurface ? null : startTurn,
          window_end_turn_number: state.doNotSurface ? null : endTurn,
          best_turn_number: state.doNotSurface
            ? null
            : state.placementWindow.bestTurn,
          do_not_surface: state.doNotSurface,
          extends_before: !state.doNotSurface && startTurn !== null && startTurn < excerptStart,
          extends_after: !state.doNotSurface && endTurn !== null && endTurn > excerptEnd,
          pertinence: state.doNotSurface ? null : state.pertinence,
          rationale: state.rationale || null,
        };

        if (state.annotationId) {
          // Update existing
          const updated = await updateAnnotation(state.annotationId, payload);
          setCompletedAnnotations((prev) => {
            const next = new Map(prev);
            next.set(knowledgeItemId, updated);
            return next;
          });
          setAllConversationAnnotations((prev) =>
            prev.map((a) => (a.id === updated.id ? updated : a))
          );
          setAnnotationStates((prev) => {
            const next = new Map(prev);
            next.set(knowledgeItemId, {
              annotationId: updated.id,
              doNotSurface: updated.do_not_surface,
              pertinence: updated.pertinence ?? -1,
              rationale: updated.rationale ?? "",
              placementWindow: {
                startTurn: updated.window_start_turn_number,
                endTurn: updated.window_end_turn_number,
                bestTurn: updated.best_turn_number,
              },
            });
            return next;
          });
        } else {
          // Create new
          const created = await createAnnotation(payload);
          setAnnotationStates((prev) => {
            const next = new Map(prev);
            next.set(knowledgeItemId, {
              annotationId: created.id,
              doNotSurface: created.do_not_surface,
              pertinence: created.pertinence ?? -1,
              rationale: created.rationale ?? "",
              placementWindow: {
                startTurn: created.window_start_turn_number,
                endTurn: created.window_end_turn_number,
                bestTurn: created.best_turn_number,
              },
            });
            return next;
          });
          setCompletedAnnotations((prev) => {
            const next = new Map(prev);
            next.set(knowledgeItemId, created);
            return next;
          });
          setAllConversationAnnotations((prev) => [...prev, created]);
        }
      } catch (error) {
        setSaveError("Failed to save annotation. Please try again.");
        throw error;
      } finally {
        setIsSaving(false);
      }
    },
    [excerptId]
  );

  // State update helpers (no auto-save)
  const updateCurrentState = useCallback(
    (updater: (prev: AnnotationState) => AnnotationState) => {
      if (!currentKnowledgeItemId) return;
      // Clear success/error messages when user makes changes
      setSaveSuccess(false);
      setSaveError(null);
      setAnnotationStates((prev) => {
        const next = new Map(prev);
        const current = next.get(currentKnowledgeItemId);
        if (current) {
          const updated = updater(current);
          next.set(currentKnowledgeItemId, updated);
        }
        return next;
      });
    },
    [currentKnowledgeItemId]
  );

  const handleTurnSelected = useCallback(
    (turnNumber: number) => {
      if (!selectingFor) return;
      updateCurrentState((prev) => {
        const w = { ...prev.placementWindow };
        if (selectingFor === "start") {
          w.startTurn = turnNumber;
          if (w.endTurn !== null && w.endTurn < turnNumber) w.endTurn = null;
          if (w.bestTurn !== null && (w.endTurn === null || w.bestTurn < turnNumber || w.bestTurn > (w.endTurn ?? turnNumber))) w.bestTurn = null;
        } else if (selectingFor === "end") {
          w.endTurn = turnNumber;
          if (w.bestTurn !== null && w.bestTurn > turnNumber) w.bestTurn = null;
        } else if (selectingFor === "best") {
          w.bestTurn = turnNumber;
        }
        return { ...prev, placementWindow: w };
      });
      setSelectingFor(null);
    },
    [selectingFor, updateCurrentState]
  );

  const handleDoNotSurfaceToggle = useCallback(
    (active: boolean) => {
      setSelectingFor(null);
      updateCurrentState((prev) => ({
        ...prev,
        doNotSurface: active,
        // Retain all state when toggling, don't clear placement window
      }));
    },
    [updateCurrentState]
  );

  const handleRationaleChange = useCallback(
    (rationale: string) => {
      updateCurrentState((prev) => ({
        ...prev,
        rationale,
      }));
    },
    [updateCurrentState]
  );

  // Global navigation across all conversation assignments
  const globalIndex = useMemo(() => {
    if (!currentKnowledgeItemId) return 0;
    const idx = allConversationAssignments.findIndex(
      (a) => a.excerpt_id === excerptId && a.knowledge_item_id === currentKnowledgeItemId
    );
    return idx >= 0 ? idx : 0;
  }, [allConversationAssignments, excerptId, currentKnowledgeItemId]);

  const handlePrevious = useCallback(async () => {
    // Save current item before navigating
    if (currentKnowledgeItemId && currentState) {
      const status = getItemStatus(currentKnowledgeItemId);
      if (status !== "pending") {
        try {
          await saveCurrentItem(currentKnowledgeItemId, currentState);
        } catch {
          return; // Don't navigate if save fails
        }
      }
    }

    // Clear feedback states when navigating
    setSaveSuccess(false);
    setSaveError(null);
    setShowRanking(false);
    setSelectingFor(null);
    const prevIdx = globalIndex - 1;
    if (prevIdx < 0) return;
    const prevAssignment = allConversationAssignments[prevIdx];
    if (prevAssignment.excerpt_id !== excerptId) {
      const qs = conversationScope ? `?conversation=${conversationScope}` : "";
      navigate(`/annotation/${prevAssignment.excerpt_id}${qs}`);
    } else {
      setCurrentItemIndex((prev) => Math.max(0, prev - 1));
    }
  }, [globalIndex, allConversationAssignments, excerptId, navigate, currentKnowledgeItemId, currentState, getItemStatus, saveCurrentItem, conversationScope]);

  // State to track if we're on the summary view
  const [showSummary, setShowSummary] = useState(searchParams.get("ranking") === "true");

  const handleNext = useCallback(async () => {
    // Validate and save current item before proceeding
    if (currentKnowledgeItemId && currentState) {
      const status = getItemStatus(currentKnowledgeItemId);
      if (status === "pending") {
        setSaveError("Please complete all required fields before proceeding.");
        return; // Prevent navigation if validation fails
      }

      // Save the current item
      try {
        await saveCurrentItem(currentKnowledgeItemId, currentState);
      } catch {
        return; // Don't navigate if save fails
      }
    }

    // Clear feedback states when navigating
    setSaveSuccess(false);
    setSaveError(null);
    setShowRanking(false);
    setSelectingFor(null);

    const nextIdx = globalIndex + 1;

    // If we're at the last item, check if all conversation items are done for summary
    if (nextIdx >= allConversationAssignments.length) {
      // We'll check allConversationItemsAnnotated after it's computed
      setShowSummary(true);
      return;
    }

    const nextAssignment = allConversationAssignments[nextIdx];
    if (nextAssignment.excerpt_id !== excerptId) {
      const qs = conversationScope ? `?conversation=${conversationScope}` : "";
      navigate(`/annotation/${nextAssignment.excerpt_id}${qs}`);
    } else {
      setCurrentItemIndex((prev) => prev + 1);
    }
  }, [globalIndex, allConversationAssignments, excerptId, navigate, currentKnowledgeItemId, currentState, getItemStatus, saveCurrentItem, conversationScope]);

  // Ranking save handler (just saves, no navigation)
  const handleRankingSave = useCallback(
    async (
      ranked: Array<{
        knowledge_item_id: string;
        rank: number;
        chosen_best_turn_number: number;
      }>
    ) => {
      await submitRanking(excerptId, { ranked_items: ranked });
    },
    [excerptId]
  );

  // Ranking submit handler (marks done + navigates to waiting screen)
  const handleRankingSubmit = useCallback(() => {
    if (excerpt?.conversation_id) {
      markAnnotationDone(excerpt.conversation_id).catch(() => {});
    }
    setShowRanking(false);
    setShowRankingWaiting(true);
  }, [excerpt]);

  const handleEditRankingFromWaiting = useCallback(async () => {
    if (excerpt?.conversation_id) {
      try { await unmarkAnnotationDone(excerpt.conversation_id); } catch { /* best effort */ }
    }
    setShowRankingWaiting(false);
    setShowRanking(true);
  }, [excerpt]);

  // Check if all items in this EXCERPT are annotated (for showing next/ranking prompt)
  const allExcerptItemsAnnotated = useMemo(() => {
    return assignments.every((a) => {
      const status = getItemStatus(a.knowledge_item_id);
      return status === "placed" || status === "do-not-surface";
    });
  }, [assignments, getItemStatus]);

  // Check if all items in the entire CONVERSATION are annotated (for enabling ranking)
  const allConversationItemsAnnotated = useMemo(() => {
    if (allConversationAssignments.length === 0) return false;
    const annotatedIds = new Set(allConversationAnnotations.map((a) => a.knowledge_item_id));
    return allConversationAssignments.every((a) => annotatedIds.has(a.knowledge_item_id));
  }, [allConversationAssignments, allConversationAnnotations]);

  // Fetch rankable items from API (includes user's own items).
  // Refetches each time the user enters ranking mode to reflect latest annotations.
  const [rankableItems, setRankableItems] = useState<RankableItem[]>([]);
  useEffect(() => {
    if ((!allConversationItemsAnnotated && !showRankingWaiting) || !excerpt?.conversation_id) return;
    let cancelled = false;
    getRankableItems(excerpt.conversation_id).then((items) => {
      if (cancelled) return;
      const mapped = items.map((i) => ({
        knowledge_item_id: i.knowledge_item_id,
        neutralized_ideal_response: i.neutralized_ideal_response,
        contribution_type: i.contribution_type,
        best_turn_number: i.best_turn_number,
        best_turn_text: i.best_turn_text ?? undefined,
        best_turn_speaker: i.best_turn_speaker ?? undefined,
        is_own_item: i.is_own_item,
        do_not_surface: i.do_not_surface,
      }));
      mapped.sort((a, b) => (a.do_not_surface ? 1 : 0) - (b.do_not_surface ? 1 : 0));
      setRankableItems(mapped);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [allConversationItemsAnnotated, excerpt?.conversation_id, showRanking, showRankingWaiting]);

  // Ranking ↔ transcript linkage state
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  const [scrollToTranscriptItem, setScrollToTranscriptItem] = useState<string | null>(null);
  const [scrollToRankingItem, setScrollToRankingItem] = useState<string | null>(null);

  const rankingItemMarkers: ItemMarker[] = useMemo(() => {
    const markers: ItemMarker[] = [];
    for (let idx = 0; idx < rankableItems.length; idx++) {
      const item = rankableItems[idx];
      if (item.do_not_surface) continue;
      markers.push({
        itemId: item.knowledge_item_id,
        turnNumber: item.best_turn_number,
        rank: idx + 1,
        label: item.neutralized_ideal_response.slice(0, 40) + (item.neutralized_ideal_response.length > 40 ? "..." : ""),
      });
    }
    return markers;
  }, [rankableItems]);

  const handleTranscriptMarkerHover = useCallback((itemId: string | null) => {
    setHighlightedItemId(itemId);
    setScrollToRankingItem(itemId);
    if (itemId) setTimeout(() => setScrollToRankingItem(null), 100);
  }, []);

  const handleRankingItemHover = useCallback((itemId: string | null) => {
    setHighlightedItemId(itemId);
    setScrollToTranscriptItem(itemId);
    if (itemId) setTimeout(() => setScrollToTranscriptItem(null), 100);
  }, []);

  const handleRankingReorder = useCallback((reordered: RankableItem[]) => {
    setRankableItems(reordered);
  }, []);

  // Loading state
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-gray-400">Loading excerpt...</div>
      </div>
    );
  }

  // Error state
  if (loadError || !excerpt) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-red-600">
            {loadError ?? "Excerpt not found."}
          </p>
          <button
            onClick={() => navigate(backPath)}
            className="mt-3 text-sm text-indigo-600 hover:underline"
          >
            {conversationScope ? "Back to My Groups" : "Back to assignments"}
          </button>
        </div>
      </div>
    );
  }

  // If showing ranking waiting/summary screen
  if (showRankingWaiting) {
    return (
      <RankingWaitingView
        conversationId={excerpt?.conversation_id ?? ""}
        rankableItems={rankableItems}
        onEditRanking={handleEditRankingFromWaiting}
        advancedToDeliberation={advancedToDeliberation}
      />
    );
  }

  // If showing ranking — split layout with transcript on left
  if (showRanking) {
    return (
      <div className="relative flex h-full flex-col">
        <div className="shrink-0 border-b border-gray-200 bg-white px-4 py-2.5">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowRanking(false)}
              className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                <path fillRule="evenodd" d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
              </svg>
              Back to items
            </button>
            <div className="flex-1">
              <span className="text-sm font-semibold text-gray-800">Rank the messages</span>
            </div>
          </div>
        </div>

        <div ref={containerRef} className="flex flex-1 flex-col overflow-hidden lg:flex-row">
          {/* Left panel: transcript */}
          <div
            className="flex h-1/2 flex-col border-b border-gray-200 lg:h-full lg:border-b-0 lg:border-r"
            style={{ flexBasis: `${leftWidthPercent}%` }}
          >
            <div className="shrink-0 border-b border-gray-200 bg-white px-4 py-2.5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-800">Transcript</h2>
                <span className="text-xs text-gray-400">
                  {conversation?.turns.length ?? 0} turn
                  {(conversation?.turns.length ?? 0) !== 1 ? "s" : ""}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-gray-400">
                Hover items below or in the ranking to see where they appear
              </p>
            </div>
            <div className="flex-1 overflow-hidden">
              <TranscriptPanel
                turns={conversation?.turns ?? []}
                placementWindow={{ startTurn: null, endTurn: null, bestTurn: null }}
                disabled
                itemMarkers={rankingItemMarkers}
                highlightedItemId={highlightedItemId}
                onMarkerHover={handleTranscriptMarkerHover}
                scrollToItemId={scrollToTranscriptItem}
              />
            </div>
          </div>

          <ResizeHandle onResize={setLeftWidthPercent} containerRef={containerRef} />

          {/* Right panel: ranking */}
          <div
            className="flex h-1/2 flex-col lg:h-full"
            style={{ flexBasis: `${100 - leftWidthPercent}%` }}
          >
            <div className="flex-1 overflow-y-auto p-4">
              <RankingPanel
                items={rankableItems}
                onSave={handleRankingSave}
                onSubmit={handleRankingSubmit}
                highlightedItemId={highlightedItemId}
                onItemHover={handleRankingItemHover}
                scrollToItemId={scrollToRankingItem}
                onReorder={handleRankingReorder}
              />
            </div>
          </div>
        </div>

        {advancedToDeliberation && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/60">
            <div className="mx-4 w-full max-w-sm rounded-xl border border-gray-200 bg-white p-6 shadow-lg">
              <h2 className="text-lg font-semibold text-gray-900">
                Moving to Review & Revise
              </h2>
              <p className="mt-2 text-sm text-gray-600">
                All group members have completed their annotations and rankings.
                Your group is now ready for the review & revise stage.
              </p>
              <button
                onClick={() => {
                  const first = allConversationAssignments[0];
                  if (first && excerpt) {
                    navigate(`/deliberation/${first.excerpt_id}?knowledge_item_id=${first.knowledge_item_id}&conversation=${excerpt.conversation_id}`);
                  } else {
                    navigate("/deliberation");
                  }
                }}
                className="mt-5 w-full rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500"
              >
                Go to Review & Revise
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // If showing summary after completing all annotations
  if (showSummary) {
    const PERTINENCE_LABELS: Record<number, string> = {
      0.0: "Nice to have",
      0.25: "Somewhat important",
      0.5: "Important",
      0.75: "Very important",
      1.0: "Essential",
    };

    return (
      <div className="flex h-full flex-col">
        <div className="shrink-0 border-b border-gray-200 bg-white px-4 py-2.5">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowSummary(false)}
              className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                <path fillRule="evenodd" d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
              </svg>
              Back to items
            </button>
            <div className="flex-1">
              <span className="text-sm font-semibold text-gray-800">Annotation Summary</span>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-4xl space-y-6">
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">
                All items annotated
              </h2>
              <p className="mt-2 text-sm text-gray-600">
                You've completed annotations for all {allConversationAssignments.length} items in this conversation. Review your decisions below, then proceed to ranking.
              </p>
            </div>

            <div className="space-y-3">
              {allConversationAssignments.map((assignment, idx) => {
                // Get annotation from allConversationAnnotations
                const annotation = allConversationAnnotations.find(
                  ann => ann.knowledge_item_id === assignment.knowledge_item_id
                );

                if (!annotation) return null;

                const excerptDetail = allExcerptDetails.get(assignment.excerpt_id);
                const itemDescription = excerptDetail?.knowledge_item.neutralized_ideal_response || assignment.item_contribution_type;

                return (
                  <div
                    key={assignment.knowledge_item_id}
                    className={`rounded-lg border p-4 ${
                      annotation.do_not_surface
                        ? "border-gray-300 bg-gray-50"
                        : "border-indigo-200 bg-white"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className={`shrink-0 flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                        annotation.do_not_surface
                          ? "bg-gray-400 text-white"
                          : "bg-indigo-600 text-white"
                      }`}>
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 line-clamp-2">
                          {renderMarkdown(itemDescription)}
                        </p>

                        {annotation.do_not_surface ? (
                          <div className="mt-2">
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-200 px-2.5 py-0.5 text-xs font-medium text-gray-700">
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                                <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
                              </svg>
                              Should not surface
                            </span>
                            {annotation.rationale && (
                              <p className="mt-2 text-xs text-gray-600 italic">
                                "{annotation.rationale}"
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="mt-3 space-y-2">
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                              <div>
                                <span className="text-gray-500">Placement window:</span>
                                <span className="ml-1.5 font-mono font-semibold text-gray-900">
                                  #{annotation.window_start_turn_number} - #{annotation.window_end_turn_number}
                                </span>
                              </div>
                              <div>
                                <span className="text-gray-500">Best turn:</span>
                                <span className="ml-1.5 font-mono font-semibold text-indigo-600">
                                  #{annotation.best_turn_number}
                                </span>
                              </div>
                              <div>
                                <span className="text-gray-500">Importance:</span>
                                <span className="ml-1.5 font-medium text-gray-900">
                                  {PERTINENCE_LABELS[annotation.pertinence || 0] || annotation.pertinence}
                                </span>
                              </div>
                            </div>
                            {annotation.rationale && (
                              <div className="pt-1">
                                <p className="text-xs text-gray-600">
                                  <span className="font-medium text-gray-700">Rationale:</span> {annotation.rationale}
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => {
                          setShowSummary(false);
                          // Navigate to the correct excerpt and item
                          const qs = conversationScope ? `?conversation=${conversationScope}` : "";
                          if (assignment.excerpt_id !== excerptId) {
                            navigate(`/annotation/${assignment.excerpt_id}${qs}`);
                          } else {
                            const localIdx = assignments.findIndex(
                              (a) => a.knowledge_item_id === assignment.knowledge_item_id
                            );
                            if (localIdx >= 0) setCurrentItemIndex(localIdx);
                          }
                        }}
                        className="shrink-0 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-center pt-4">
              <button
                onClick={() => setShowRanking(true)}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-indigo-600 px-6 py-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  className="h-4 w-4"
                >
                  <path d="M2 3.75A.75.75 0 0 1 2.75 3h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 3.75ZM2 8a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 8Zm0 4.25a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z" />
                </svg>
                Proceed to Ranking
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col">
      {advancedToDeliberation && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/60">
          <div className="mx-4 w-full max-w-sm rounded-xl border border-gray-200 bg-white p-6 shadow-lg">
            <h2 className="text-lg font-semibold text-gray-900">
              Moving to Review & Revise
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              All group members have completed their annotations and rankings.
              Your group is now ready for the review & revise stage.
            </p>
            <button
              onClick={() => {
                const first = allConversationAssignments[0];
                if (first && excerpt) {
                  navigate(`/deliberation/${first.excerpt_id}?knowledge_item_id=${first.knowledge_item_id}&conversation=${excerpt.conversation_id}`);
                } else {
                  navigate("/deliberation");
                }
              }}
              className="mt-5 w-full rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500"
            >
              Go to Review & Revise
            </button>
          </div>
        </div>
      )}

      {/* Top bar: progress */}
      <div className="shrink-0 border-b border-gray-200 bg-white px-4 py-2.5">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <ProgressIndicator
              completed={allConversationAnnotations.length}
              total={allConversationAssignments.length}
              currentIndex={globalIndex}
              onPrevious={handlePrevious}
              onNext={handleNext}
              hasPrevious={globalIndex > 0}
              hasNext={globalIndex < allConversationAssignments.length || showSummary}
              disableNext={currentKnowledgeItemId ? getItemStatus(currentKnowledgeItemId) === "pending" : false}
            />
          </div>

          {/* Status messages */}
          <div className="shrink-0 flex items-center gap-2">
            <div className="text-xs">
              {isSaving && <span className="text-gray-500">Saving...</span>}
              {saveError && <span className="text-red-500">{saveError}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Main split layout */}
      <div
        ref={containerRef}
        className="flex flex-1 flex-col overflow-hidden lg:flex-row"
      >
        {/* Left panel: transcript */}
        <div
          className="flex h-1/2 flex-col border-b border-gray-200 lg:h-full lg:border-b-0 lg:border-r"
          style={{ flexBasis: `${leftWidthPercent}%` }}
        >
          <div className="shrink-0 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2.5">
            <h2 className="text-sm font-semibold text-gray-800">Transcript</h2>
            <span className="text-xs text-gray-400">
              {conversation?.turns.length ?? 0} turn
              {(conversation?.turns.length ?? 0) !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="flex-1 overflow-hidden">
            <TranscriptPanel
              turns={conversation?.turns ?? []}
              placementWindow={
                currentState?.placementWindow ?? {
                  startTurn: null,
                  endTurn: null,
                  bestTurn: null,
                }
              }
              selectingFor={selectingFor}
              onTurnSelected={handleTurnSelected}
              disabled={currentState?.doNotSurface ?? false}
              knowledgeItemText={
                excerpt?.knowledge_item.neutralized_ideal_response ?? null
              }
            />
          </div>
        </div>

        {/* Resize handle (desktop only) */}
        <ResizeHandle onResize={setLeftWidthPercent} containerRef={containerRef} />

        {/* Right panel: sidebar */}
        <div
          className="flex h-1/2 flex-col lg:h-full"
          style={{ flexBasis: `${100 - leftWidthPercent}%` }}
        >
          <div className="shrink-0 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2.5">
            <h2 className="text-sm font-semibold text-gray-800">Annotation</h2>
          </div>

          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4">
              {currentAssignment && currentState ? (
                <div className="flex flex-col gap-4">
                  {/* Knowledge item card */}
                  <KnowledgeItemCard
                    neutralizedIdealResponse={
                      excerpt.knowledge_item.neutralized_ideal_response
                    }
                    contributionType={
                      excerpt.knowledge_item.contribution_type
                    }
                    status={getItemStatus(currentAssignment.knowledge_item_id)}
                  />

                  {/* Do not surface zone */}
                  <DoNotSurfaceZone
                    active={currentState.doNotSurface}
                    rationale={currentState.rationale}
                    onToggle={handleDoNotSurfaceToggle}
                    onRationaleChange={handleRationaleChange}
                  />

                  {!currentState.doNotSurface && (
                    <>
                      {/* Step 1: Placement window */}
                      <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                        <p className="mb-2 text-sm font-medium text-gray-700">
                          1. Choose the turns after which this message could appear <span className="text-red-500">*</span>
                        </p>
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" />
                            <span className="text-sm font-medium text-gray-700 whitespace-nowrap" title="The first turn after which this message becomes relevant">First relevant:</span>
                            <span className="font-mono text-sm font-semibold text-gray-800 w-8">
                              {currentState.placementWindow.startTurn !== null ? `#${currentState.placementWindow.startTurn}` : "--"}
                            </span>
                            <button
                              type="button"
                              onClick={() => setSelectingFor(selectingFor === "start" ? null : "start")}
                              className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                                selectingFor === "start"
                                  ? "border-green-400 bg-green-100 text-green-700"
                                  : "border-gray-300 text-gray-600 hover:bg-gray-100"
                              }`}
                            >
                              {selectingFor === "start" ? "Selecting..." : currentState.placementWindow.startTurn !== null ? "Change" : "Select"}
                            </button>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
                            <span className="text-sm font-medium text-gray-700 whitespace-nowrap" title="The last turn after which inserting would still help">Last useful:</span>
                            <span className="font-mono text-sm font-semibold text-gray-800 w-8">
                              {currentState.placementWindow.endTurn !== null ? `#${currentState.placementWindow.endTurn}` : "--"}
                            </span>
                            <button
                              type="button"
                              disabled={currentState.placementWindow.startTurn === null}
                              onClick={() => setSelectingFor(selectingFor === "end" ? null : "end")}
                              className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                                selectingFor === "end"
                                  ? "border-red-400 bg-red-100 text-red-700"
                                  : "border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                              }`}
                            >
                              {selectingFor === "end" ? "Selecting..." : currentState.placementWindow.endTurn !== null ? "Change" : "Select"}
                            </button>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                            <span className="text-sm font-medium text-gray-700 whitespace-nowrap" title="The ideal insertion point">Best placement:</span>
                            <span className="font-mono text-sm font-semibold text-gray-800 w-8">
                              {currentState.placementWindow.bestTurn !== null ? `#${currentState.placementWindow.bestTurn}` : "--"}
                            </span>
                            <button
                              type="button"
                              disabled={currentState.placementWindow.startTurn === null || currentState.placementWindow.endTurn === null}
                              onClick={() => setSelectingFor(selectingFor === "best" ? null : "best")}
                              className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                                selectingFor === "best"
                                  ? "border-amber-400 bg-amber-100 text-amber-700"
                                  : "border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                              }`}
                            >
                              {selectingFor === "best" ? "Selecting..." : currentState.placementWindow.bestTurn !== null ? "Change" : "Select"}
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Step 2: Pertinence */}
                      <div>
                        <label className="mb-2 block text-sm font-medium text-gray-700">
                          2. How important would this message be for the conversation? <span className="text-red-500">*</span>
                        </label>
                        <div className="space-y-1.5">
                          {PERTINENCE_LEVELS.map((level) => (
                            <label
                              key={level.value}
                              className={`flex items-start gap-2.5 rounded-md border px-3 py-2 cursor-pointer transition-colors ${
                                currentState.pertinence === level.value
                                  ? "border-indigo-400 bg-indigo-50"
                                  : "border-gray-200 bg-white hover:border-gray-300"
                              }`}
                            >
                              <input
                                type="radio"
                                name="pertinence"
                                checked={currentState.pertinence === level.value}
                                onChange={() =>
                                  updateCurrentState((prev) => ({
                                    ...prev,
                                    pertinence: level.value,
                                  }))
                                }
                                className="mt-0.5 h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300"
                              />
                              <span className="text-sm text-gray-700">
                                <span className="font-semibold">{level.title}</span> — {level.description}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>

                      {/* Step 3: Rationale */}
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-gray-700">
                          3. Rationale (optional)
                        </label>
                        <textarea
                          value={currentState.rationale}
                          onChange={(e) => handleRationaleChange(e.target.value)}
                          placeholder="Why did you choose this placement and these ratings?"
                          rows={3}
                          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                        />
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="flex h-full items-center justify-center">
                  <p className="text-sm text-gray-400">
                    No assignment selected.
                  </p>
                </div>
              )}
            </div>

            {/* Submit button pinned at bottom */}
            {currentAssignment && currentState && (
              <div className="shrink-0 border-t border-gray-200 bg-white px-4 py-3">
                <button
                  onClick={async () => {
                    if (!currentKnowledgeItemId || !currentState) return;
                    setSaveSuccess(false);
                    setSaveError(null);
                    try {
                      await saveCurrentItem(currentKnowledgeItemId, currentState);
                      setSaveSuccess(true);
                      // Auto-hide success message after 3 seconds
                      setTimeout(() => setSaveSuccess(false), 3000);
                    } catch {
                      // Error is already set in saveCurrentItem
                    }
                  }}
                  disabled={
                    isSaving ||
                    !currentKnowledgeItemId ||
                    getItemStatus(currentKnowledgeItemId) === "pending"
                  }
                  className={`w-full rounded-md px-4 py-2.5 text-sm font-medium shadow-sm transition-all duration-200 ${
                    saveSuccess
                      ? "bg-green-600 text-white"
                      : isSaving ||
                        !currentKnowledgeItemId ||
                        getItemStatus(currentKnowledgeItemId) === "pending"
                      ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                      : "bg-indigo-600 text-white hover:bg-indigo-500"
                  }`}
                >
                  {isSaving ? (
                    <span className="inline-flex items-center justify-center gap-2">
                      <svg
                        className="h-4 w-4 animate-spin"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
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
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      Saving...
                    </span>
                  ) : saveSuccess ? (
                    <span className="inline-flex items-center justify-center gap-2">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className="h-5 w-5"
                      >
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
                          clipRule="evenodd"
                        />
                      </svg>
                      Saved!
                    </span>
                  ) : (
                    "Save Annotation"
                  )}
                </button>

                {/* Error message */}
                {saveError && (
                  <div className="mt-2 flex items-start gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="h-4 w-4 text-red-600 shrink-0 mt-0.5"
                    >
                      <path
                        fillRule="evenodd"
                        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <div className="flex-1">
                      <p className="text-xs text-red-800 font-medium">
                        {saveError}
                      </p>
                    </div>
                  </div>
                )}

                {/* Success message */}
                {saveSuccess && !saveError && (
                  <div className="mt-2 flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-3 py-2">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="h-4 w-4 text-green-600 shrink-0"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <p className="text-xs text-green-800 font-medium">
                      Annotation saved successfully
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Conversation-scoped redirect ───────────────────────────────────

function ConversationRedirect({ conversationId }: { conversationId: string }) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function resolve() {
      try {
        const assignments = await getAssignments();
        if (cancelled) return;

        const convAssignments = assignments.filter(
          (a) => a.conversation_id === conversationId
        );

        if (convAssignments.length === 0) {
          setError("No annotation assignments found for this conversation.");
          return;
        }

        // Find first incomplete excerpt
        const firstIncomplete = convAssignments.find((a) => !a.completed);
        if (firstIncomplete) {
          navigate(
            `/annotation/${firstIncomplete.excerpt_id}?conversation=${conversationId}`,
            { replace: true }
          );
        } else {
          // All complete — go to ranking for the first excerpt
          navigate(
            `/annotation/${convAssignments[0].excerpt_id}?conversation=${conversationId}&ranking=true`,
            { replace: true }
          );
        }
      } catch {
        if (!cancelled) setError("Failed to load assignments.");
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
      <div className="text-sm text-gray-400">Loading assignments...</div>
    </div>
  );
}

// ── Page Entry Point ────────────────────────────────────────────────

export default function CrossAnnotationPage() {
  const { excerptId } = useParams<{ excerptId: string }>();
  const [searchParams] = useSearchParams();
  const conversationId = searchParams.get("conversation");

  if (!excerptId) {
    if (conversationId) {
      return <ConversationRedirect conversationId={conversationId} />;
    }
    return <AssignmentListView />;
  }

  return <AnnotationInterfaceView excerptId={excerptId} />;
}
