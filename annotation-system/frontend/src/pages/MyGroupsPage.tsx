import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { getMyGroups, resumeConversation, type MyGroup } from "@/api/conversations";
import { markConstructionDone, unmarkConstructionDone } from "@/api/construction";
import { getDeliberationProgress, getDeliberationAssignments } from "@/api/deliberation";
import { getRankingDeliberationProgress, getRankingDeliberationExcerpts } from "@/api/rankingDeliberation";

const STATUS_COLORS: Record<string, string> = {
  conversation: "bg-green-100 text-green-700",
  construction: "bg-yellow-100 text-yellow-700",
  neutralization: "bg-purple-100 text-purple-700",
  cross_annotation: "bg-orange-100 text-orange-700",
  deliberation: "bg-cyan-100 text-cyan-700",
  complete: "bg-gray-200 text-gray-800",
};

const STATUS_LABELS: Record<string, string> = {
  conversation: "Stage 1: Conversation",
  construction: "Stage 2: Create Messages",
  neutralization: "Processing messages",
  cross_annotation: "Stage 3: Annotate",
  deliberation: "Stage 4: Review & Revise",
  complete: "Complete",
};

function ReviewReviseButton({ conversationId }: { conversationId: string }) {
  const navigate = useNavigate();
  const [resolving, setResolving] = useState(false);

  const handleClick = useCallback(async () => {
    setResolving(true);
    try {
      // Stage 1: Check annotation deliberation progress
      const [delibProgress, delibAssignments] = await Promise.all([
        getDeliberationProgress(),
        getDeliberationAssignments(),
      ]);

      const convAssignments = delibAssignments.filter(
        (a) => a.conversation_id === conversationId
      );

      if (delibProgress.completed < delibProgress.total && convAssignments.length > 0) {
        // Find first unreviewed annotation item
        const reviewedSet = new Set(delibProgress.revised_knowledge_item_ids);
        const firstUnreviewed = convAssignments.find(
          (a) => !reviewedSet.has(a.knowledge_item_id)
        );
        if (firstUnreviewed) {
          navigate(
            `/deliberation/${firstUnreviewed.excerpt_id}?knowledge_item_id=${firstUnreviewed.knowledge_item_id}&conversation=${conversationId}`
          );
          return;
        }
      }

      // Stage 2: Check ranking deliberation progress
      const [rankingProgress, rankingExcerpts] = await Promise.all([
        getRankingDeliberationProgress(),
        getRankingDeliberationExcerpts(),
      ]);

      const convExcerpts = rankingExcerpts.filter(
        (e) => e.conversation_id === conversationId
      );

      if (!rankingProgress.ranking_deliberation_completed && convExcerpts.length > 0) {
        const revisedSet = new Set(rankingProgress.revised_excerpt_ids);
        const firstUnreviewed = convExcerpts.find(
          (e) => !revisedSet.has(e.excerpt_id)
        );
        if (firstUnreviewed) {
          navigate(
            `/ranking-deliberation/${firstUnreviewed.excerpt_id}?conversation=${conversationId}`
          );
          return;
        }
      }

      // Stage 3: Both done — go to summary
      navigate(`/ranking-deliberation/summary?conversation=${conversationId}`);
    } catch {
      // Fallback to summary on error
      navigate(`/ranking-deliberation/summary?conversation=${conversationId}`);
    } finally {
      setResolving(false);
    }
  }, [conversationId, navigate]);

  return (
    <button
      onClick={handleClick}
      disabled={resolving}
      className="inline-flex items-center gap-1.5 rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-cyan-500 transition-colors disabled:opacity-60"
    >
      {resolving ? "Loading..." : "Review & Revise"}
    </button>
  );
}

function GroupAction({ group, onResume, onMarkDone, onUnmarkDone, isResearcher }: {
  group: MyGroup;
  onResume: (conversationId: string) => void;
  onMarkDone: (conversationId: string) => void;
  onUnmarkDone: (conversationId: string) => void;
  isResearcher: boolean;
}) {
  if (!group.conversation_id) {
    return (
      <span className="text-xs text-gray-400">No conversation yet</span>
    );
  }

  switch (group.status) {
    case "conversation":
      if (group.conversation_ended_at) {
        return (
          <span className="text-xs text-gray-400">
            Conversation ended — waiting for next stage
          </span>
        );
      }
      return (
        <Link
          to={`/conversation/${group.conversation_id}`}
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 transition-colors"
        >
          Join Conversation
        </Link>
      );

    case "construction": {
      const progress = group.construction_progress;
      const isDone = group.construction_done;

      if (isDone) {
        return (
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
                <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                You're done
              </span>
              {progress && (
                <span className="text-xs text-gray-500">
                  {progress.done}/{progress.total} members finished
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span>{progress && progress.done >= progress.total ? "Waiting for admin to process messages" : "Waiting for others to complete"}</span>
            </div>
            <div className="flex items-center gap-2">
              <Link
                to={`/construction/${group.conversation_id}`}
                onClick={() => onUnmarkDone(group.conversation_id!)}
                className="inline-flex items-center gap-1 rounded-md border border-yellow-300 bg-yellow-50 px-3 py-1.5 text-xs font-medium text-yellow-700 transition-colors hover:bg-yellow-100"
              >
                Create More Messages
              </Link>
              {isResearcher && (
                <button
                  onClick={() => onResume(group.conversation_id!)}
                  className="inline-flex items-center gap-1 rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
                >
                  Resume Conversation
                </button>
              )}
            </div>
          </div>
        );
      }

      return (
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <Link
              to={`/construction/${group.conversation_id}`}
              className="inline-flex items-center gap-1.5 rounded-md bg-yellow-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-yellow-500 transition-colors"
            >
              Create Messages
            </Link>
            {isResearcher && (
              <button
                onClick={() => onResume(group.conversation_id!)}
                className="inline-flex items-center gap-1 rounded-md border border-indigo-300 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
              >
                Resume Conversation
              </button>
            )}
          </div>
          {progress && progress.done > 0 && (
            <span className="text-xs text-gray-500">
              {progress.done}/{progress.total} members finished
            </span>
          )}
        </div>
      );
    }

    case "cross_annotation":
      return (
        <Link
          to={`/annotation?conversation=${group.conversation_id}`}
          className="inline-flex items-center gap-1.5 rounded-md bg-orange-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-orange-500 transition-colors"
        >
          Annotate
        </Link>
      );

    case "deliberation":
      return (
        <ReviewReviseButton conversationId={group.conversation_id!} />
      );

    case "complete":
      return (
        <span className="text-xs text-gray-500">Completed</span>
      );

    default:
      return (
        <span className="text-xs text-gray-400">
          {STATUS_LABELS[group.status] ?? group.status.replace(/_/g, " ")}
        </span>
      );
  }
}

export default function MyGroupsPage() {
  const { user } = useAuth();
  const isResearcher = user?.role === "researcher";
  const [groups, setGroups] = useState<MyGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const initialLoadDone = useRef(false);

  const load = useCallback(async () => {
    if (!initialLoadDone.current) setLoading(true);
    setError(null);
    try {
      const data = await getMyGroups();
      setGroups(data);
      initialLoadDone.current = true;
    } catch {
      if (!initialLoadDone.current) setError("Failed to load your groups.");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleResume = useCallback(async (conversationId: string) => {
    try {
      await resumeConversation(conversationId);
      await load();
    } catch {
      setError("Failed to resume conversation.");
    }
  }, [load]);

  const handleMarkDone = useCallback(async (conversationId: string) => {
    try {
      await markConstructionDone(conversationId);
      await load();
    } catch {
      setError("Failed to mark construction as done.");
    }
  }, [load]);

  const handleUnmarkDone = useCallback(async (conversationId: string) => {
    try {
      await unmarkConstructionDone(conversationId);
    } catch {
      // Best-effort: the navigation to construction page will proceed regardless
    }
  }, []);

  useEffect(() => {
    load();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        load();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    const interval = setInterval(load, 15000);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearInterval(interval);
    };
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-gray-500">Loading your groups...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl py-8 px-4">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">My Groups</h1>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {groups.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white py-16 text-center">
          <p className="text-sm text-gray-500">
            You haven't been assigned to any groups yet.
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Ask your admin to add you to a study group.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <div
              key={g.group_id}
              className="rounded-lg border border-gray-200 bg-white overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-gray-800 capitalize">
                    {g.scenario}
                  </span>
                  <span
                    className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      STATUS_COLORS[g.status] ?? "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {STATUS_LABELS[g.status] ?? g.status.replace(/_/g, " ")}
                  </span>
                  {g.turn_count > 0 && (
                    <span className="text-xs text-gray-400">
                      {g.turn_count} messages
                    </span>
                  )}
                </div>
                <GroupAction group={g} onResume={handleResume} onMarkDone={handleMarkDone} onUnmarkDone={handleUnmarkDone} isResearcher={isResearcher} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
