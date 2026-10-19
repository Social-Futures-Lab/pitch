import { useState, useEffect, useCallback } from "react";
import { useForm } from "react-hook-form";
import {
  listGroups,
  createGroup,
  transitionGroup,
  revertGroup,
  listPrompts,
  listGroupConversations,
  listGroupMembers,
  addGroupMember,
  removeGroupMember,
  listUsers,
  getGroupItemStats,
  type StudyGroup,
  type CreateGroupPayload,
  type Prompt,
  type GroupConversation,
  type GroupMember,
  type AdminUser,
  type GroupItemStats,
} from "@/api/admin";
import { getConversation, endConversation, resumeConversation } from "@/api/conversations";
import type { Turn } from "@/types";

const SCENARIOS = ["scholar", "trip"] as const;

const STATUS_COLORS: Record<string, string> = {
  conversation: "bg-green-100 text-green-700",
  construction: "bg-yellow-100 text-yellow-700",
  neutralization: "bg-purple-100 text-purple-700",
  cross_annotation: "bg-orange-100 text-orange-700",
  deliberation: "bg-cyan-100 text-cyan-700",
  complete: "bg-gray-200 text-gray-800",
};

const PHASE_TRANSITIONS: Record<string, string[]> = {
  conversation: ["construction"],
  construction: ["neutralization"],
  neutralization: ["cross_annotation"],
  cross_annotation: ["deliberation"],
  deliberation: ["complete"],
};

function getMemberStatus(
  groupStatus: string,
  member: GroupMember,
): { label: string; color: string } {
  if (groupStatus === "complete") return { label: "9 — Complete", color: "bg-gray-200 text-gray-700" };
  if (member.deliberation_completed_at) return { label: "8 — Deliberation done", color: "bg-green-100 text-green-700" };
  if (groupStatus === "deliberation") return { label: "7 — In deliberation", color: "bg-cyan-100 text-cyan-700" };
  if (member.annotation_done_at) return { label: "6 — Annotation done", color: "bg-green-100 text-green-700" };
  if (groupStatus === "cross_annotation") return { label: "5 — In annotation", color: "bg-orange-100 text-orange-700" };
  if (groupStatus === "neutralization") return { label: "4 — Waiting for review", color: "bg-purple-100 text-purple-700" };
  if (member.construction_done_at) return { label: "3 — Construction done", color: "bg-green-100 text-green-700" };
  if (groupStatus === "construction") return { label: "2 — In construction", color: "bg-yellow-100 text-yellow-700" };
  return { label: "1 — In conversation", color: "bg-green-100 text-green-700" };
}

const PHASE_ORDER = [
  "conversation",
  "construction",
  "neutralization",
  "cross_annotation",
  "deliberation",
  "complete",
];

export default function GroupManager() {
  const [groups, setGroups] = useState<StudyGroup[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [transitioning, setTransitioning] = useState<string | null>(null);

  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<GroupConversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);

  const [expandedConvId, setExpandedConvId] = useState<string | null>(null);
  const [convTurns, setConvTurns] = useState<Turn[]>([]);
  const [turnsLoading, setTurnsLoading] = useState(false);

  const [members, setMembers] = useState<GroupMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [allUsers, setAllUsers] = useState<AdminUser[]>([]);
  const [addingMember, setAddingMember] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [itemStats, setItemStats] = useState<GroupItemStats | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<CreateGroupPayload>();

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [groupData, promptData] = await Promise.all([
        listGroups(),
        listPrompts(),
      ]);
      setGroups(groupData);
      setPrompts(promptData);
    } catch {
      setError("Failed to load groups.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onCreateGroup = async (data: CreateGroupPayload) => {
    try {
      const payload: CreateGroupPayload = {
        scenario: data.scenario,
      };
      if (data.prompt_id) {
        payload.prompt_id = data.prompt_id;
      }
      const newGroup = await createGroup(payload);
      setGroups((prev) => [newGroup, ...prev]);
      setShowForm(false);
      reset();
    } catch {
      setError("Failed to create group.");
    }
  };

  const handleTransition = async (
    groupId: string,
    targetStatus: string
  ) => {
    setTransitioning(groupId);
    try {
      const updated = await transitionGroup(groupId, {
        target_status: targetStatus,
      });
      setGroups((prev) =>
        prev.map((g) => (g.id === updated.id ? updated : g))
      );
    } catch {
      setError("Failed to transition group.");
    } finally {
      setTransitioning(null);
    }
  };

  const handleRevert = async (groupId: string, targetStatus: string) => {
    if (
      !window.confirm(
        `Revert this group to "${targetStatus.replace(/_/g, " ")}"? Existing annotations and data will be preserved.`
      )
    )
      return;
    setTransitioning(groupId);
    try {
      const updated = await revertGroup(groupId, {
        target_status: targetStatus,
      });
      setGroups((prev) =>
        prev.map((g) => (g.id === updated.id ? updated : g))
      );
    } catch {
      setError("Failed to revert group.");
    } finally {
      setTransitioning(null);
    }
  };

  const toggleGroup = async (groupId: string) => {
    if (expandedGroupId === groupId) {
      setExpandedGroupId(null);
      setConversations([]);
      setMembers([]);
      setItemStats(null);
      setExpandedConvId(null);
      setConvTurns([]);
      return;
    }

    setExpandedGroupId(groupId);
    setExpandedConvId(null);
    setConvTurns([]);
    setConversationsLoading(true);
    setMembersLoading(true);
    try {
      const [convData, memberData, userData, statsData] = await Promise.all([
        listGroupConversations(groupId),
        listGroupMembers(groupId),
        listUsers(),
        getGroupItemStats(groupId),
      ]);
      setConversations(convData);
      setMembers(memberData);
      setAllUsers(userData);
      setItemStats(statsData);
    } catch {
      setError("Failed to load group details.");
      setConversations([]);
      setMembers([]);
    } finally {
      setConversationsLoading(false);
      setMembersLoading(false);
    }
  };

  const handleAddMember = async () => {
    if (!expandedGroupId || !selectedUserId) return;
    setAddingMember(true);
    try {
      const newMember = await addGroupMember(expandedGroupId, selectedUserId);
      setMembers((prev) => [...prev, newMember]);
      setSelectedUserId("");
      setGroups((prev) =>
        prev.map((g) =>
          g.id === expandedGroupId
            ? { ...g, member_count: g.member_count + 1 }
            : g
        )
      );
    } catch {
      setError("Failed to add member.");
    } finally {
      setAddingMember(false);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!expandedGroupId) return;
    try {
      await removeGroupMember(expandedGroupId, userId);
      setMembers((prev) => prev.filter((m) => m.user_id !== userId));
      setGroups((prev) =>
        prev.map((g) =>
          g.id === expandedGroupId
            ? { ...g, member_count: Math.max(0, g.member_count - 1) }
            : g
        )
      );
    } catch {
      setError("Failed to remove member.");
    }
  };

  const handleEndConversation = async (convId: string) => {
    if (!window.confirm("End this conversation? This will move the group to the construction phase.")) return;
    try {
      await endConversation(convId);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? { ...c, ended_at: new Date().toISOString() }
            : c
        )
      );
      if (expandedGroupId) {
        setGroups((prev) =>
          prev.map((g) =>
            g.id === expandedGroupId
              ? { ...g, status: "construction" }
              : g
          )
        );
      }
    } catch {
      setError("Failed to end conversation.");
    }
  };

  const handleResumeConversation = async (convId: string) => {
    try {
      await resumeConversation(convId);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId ? { ...c, ended_at: undefined } : c
        )
      );
      if (expandedGroupId) {
        setGroups((prev) =>
          prev.map((g) =>
            g.id === expandedGroupId
              ? { ...g, status: "conversation" }
              : g
          )
        );
      }
    } catch {
      setError("Failed to resume conversation.");
    }
  };

  const toggleConversation = async (convId: string) => {
    if (expandedConvId === convId) {
      setExpandedConvId(null);
      setConvTurns([]);
      return;
    }

    setExpandedConvId(convId);
    setTurnsLoading(true);
    try {
      const data = await getConversation(convId);
      setConvTurns(data.turns ?? []);
    } catch {
      setError("Failed to load conversation turns.");
      setConvTurns([]);
    } finally {
      setTurnsLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-gray-500">Loading groups...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Study Groups</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 transition-colors"
        >
          {showForm ? "Cancel" : "Create Group"}
        </button>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 font-medium underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleSubmit(onCreateGroup)}
          className="rounded-lg border border-gray-200 bg-white p-5 space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Scenario
            </label>
            <select
              {...register("scenario", { required: true })}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            >
              <option value="">Select a scenario...</option>
              {SCENARIOS.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Prompt (optional)
            </label>
            <select
              {...register("prompt_id")}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            >
              <option value="">No prompt</option>
              {prompts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.scenario} - {p.text.substring(0, 60)}...
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50 transition-colors"
            >
              {isSubmitting ? "Creating..." : "Create Group"}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                ID
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Scenario
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Join Code
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Members
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Created
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {groups.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-sm text-gray-500"
                >
                  No groups yet. Create one to get started.
                </td>
              </tr>
            )}
            {groups.map((group) => {
              const nextPhases = PHASE_TRANSITIONS[group.status] ?? [];
              const isExpanded = expandedGroupId === group.id;
              return (
                <tr key={group.id} className="group/row">
                  <td colSpan={7} className="p-0">
                    <div
                      className={`grid grid-cols-[1fr] ${isExpanded ? "" : "hover:bg-gray-50"}`}
                    >
                      {/* Main row */}
                      <div
                        className="grid cursor-pointer hover:bg-gray-50"
                        style={{
                          gridTemplateColumns:
                            "minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,0.6fr) minmax(0,1fr) minmax(0,1.5fr)",
                        }}
                        onClick={() => toggleGroup(group.id)}
                      >
                        <div className="flex items-center gap-2 whitespace-nowrap px-4 py-3 text-sm font-mono text-gray-600">
                          <svg
                            className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform ${
                              isExpanded ? "rotate-90" : ""
                            }`}
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                              clipRule="evenodd"
                            />
                          </svg>
                          {group.id.substring(0, 8)}
                        </div>
                        <div className="whitespace-nowrap px-4 py-3 text-sm text-gray-900 capitalize">
                          {group.scenario}
                        </div>
                        <div className="whitespace-nowrap px-4 py-3">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              STATUS_COLORS[group.status] ??
                              "bg-gray-100 text-gray-700"
                            }`}
                          >
                            {group.status.replace(/_/g, " ")}
                          </span>
                        </div>
                        <div className="whitespace-nowrap px-4 py-3 text-sm font-mono text-gray-600">
                          {group.join_code}
                        </div>
                        <div className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">
                          {group.member_count}
                        </div>
                        <div className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                          {new Date(group.created_at).toLocaleDateString()}
                        </div>
                        <div
                          className="whitespace-nowrap px-4 py-3"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex gap-1.5 items-center">
                            {nextPhases.map((phase) => (
                              <button
                                key={phase}
                                onClick={() =>
                                  handleTransition(group.id, phase)
                                }
                                disabled={transitioning === group.id}
                                className="rounded-md border border-indigo-300 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 transition-colors"
                              >
                                {transitioning === group.id
                                  ? "..."
                                  : phase.replace(/_/g, " ")}
                              </button>
                            ))}
                            {nextPhases.length === 0 && (
                              <span className="text-xs text-gray-400">
                                No transitions
                              </span>
                            )}
                            {PHASE_ORDER.indexOf(group.status) > 0 && (
                              <select
                                value=""
                                onChange={(e) => {
                                  if (e.target.value) {
                                    handleRevert(group.id, e.target.value);
                                    e.target.value = "";
                                  }
                                }}
                                disabled={transitioning === group.id}
                                className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50 transition-colors cursor-pointer"
                              >
                                <option value="">Revert to...</option>
                                {PHASE_ORDER.slice(0, PHASE_ORDER.indexOf(group.status)).map(
                                  (phase) => (
                                    <option key={phase} value={phase}>
                                      {phase.replace(/_/g, " ")}
                                    </option>
                                  )
                                )}
                              </select>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Expanded group details panel */}
                      {isExpanded && (
                        <div className="border-t border-gray-100 bg-gray-50/60 px-6 py-4 space-y-5">
                          {/* Members section */}
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                Members ({members.length})
                              </p>
                              <button
                                onClick={async () => {
                                  if (!expandedGroupId) return;
                                  setMembersLoading(true);
                                  try {
                                    const [memberData, statsData, groupData] = await Promise.all([
                                      listGroupMembers(expandedGroupId),
                                      getGroupItemStats(expandedGroupId),
                                      listGroups(),
                                    ]);
                                    setMembers(memberData);
                                    setItemStats(statsData);
                                    setGroups(groupData);
                                  } catch {
                                    setError("Failed to refresh members.");
                                  } finally {
                                    setMembersLoading(false);
                                  }
                                }}
                                disabled={membersLoading}
                                className="text-xs text-gray-500 hover:text-indigo-600 disabled:opacity-50 transition-colors"
                              >
                                ↺ Refresh
                              </button>
                            </div>
                            {membersLoading ? (
                              <p className="text-sm text-gray-500">Loading members...</p>
                            ) : (
                              <>
                                {members.length > 0 && (
                                  <div className="space-y-1 mb-3">
                                    {members.map((m) => (
                                      <div
                                        key={m.id}
                                        className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-1.5"
                                      >
                                        <div className="flex items-center gap-2">
                                          <span className="text-sm font-medium text-gray-800">
                                            {m.name}
                                          </span>
                                          {m.email && (
                                            <span className="text-xs text-gray-400">
                                              {m.email}
                                            </span>
                                          )}
                                          <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                                            {m.role.replace(/_/g, " ")}
                                          </span>
                                          {(() => {
                                            const group = groups.find((g) => g.id === expandedGroupId);
                                            if (!group) return null;
                                            const st = getMemberStatus(group.status, m);
                                            return (
                                              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${st.color}`}>
                                                {st.label}
                                              </span>
                                            );
                                          })()}
                                        </div>
                                        <button
                                          onClick={() => handleRemoveMember(m.user_id)}
                                          className="text-xs text-red-500 hover:text-red-700 transition-colors"
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <div className="flex gap-2">
                                  <select
                                    value={selectedUserId}
                                    onChange={(e) => setSelectedUserId(e.target.value)}
                                    className="flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                                  >
                                    <option value="">Select a user to add...</option>
                                    {allUsers
                                      .filter(
                                        (u) =>
                                          !members.some((m) => m.user_id === u.id)
                                      )
                                      .map((u) => (
                                        <option key={u.id} value={u.id}>
                                          {u.name} ({u.email ?? u.role})
                                        </option>
                                      ))}
                                  </select>
                                  <button
                                    onClick={handleAddMember}
                                    disabled={!selectedUserId || addingMember}
                                    className="shrink-0 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
                                  >
                                    {addingMember ? "Adding..." : "Add Member"}
                                  </button>
                                </div>
                              </>
                            )}
                          </div>

                          {/* Item stats section */}
                          {itemStats && itemStats.total > 0 && (
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                                Knowledge Items
                              </p>
                              <div className="flex flex-wrap gap-2">
                                <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
                                  {itemStats.total} total
                                </span>
                                {itemStats.pending > 0 && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-700">
                                    {itemStats.pending} pending review
                                  </span>
                                )}
                                {itemStats.approved > 0 && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                                    {itemStats.approved} approved
                                  </span>
                                )}
                                {itemStats.rejected > 0 && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
                                    {itemStats.rejected} rejected
                                  </span>
                                )}
                                <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-medium text-purple-700">
                                  {itemStats.neutralized} neutralized
                                </span>
                              </div>
                            </div>
                          )}

                          {/* Conversations section */}
                          {conversationsLoading ? (
                            <p className="text-sm text-gray-500">
                              Loading conversations...
                            </p>
                          ) : conversations.length === 0 ? (
                            <p className="text-sm text-gray-400 italic">
                              No conversations in this group.
                            </p>
                          ) : (
                            <div className="space-y-2">
                              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                                Conversations ({conversations.length})
                              </p>
                              {conversations.map((conv) => {
                                const isConvExpanded =
                                  expandedConvId === conv.id;
                                return (
                                  <div
                                    key={conv.id}
                                    className="rounded-lg border border-gray-200 bg-white overflow-hidden"
                                  >
                                    <div
                                      className="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors"
                                      onClick={() =>
                                        toggleConversation(conv.id)
                                      }
                                    >
                                      <div className="flex items-center gap-3">
                                        <svg
                                          className={`h-3 w-3 shrink-0 text-gray-400 transition-transform ${
                                            isConvExpanded ? "rotate-90" : ""
                                          }`}
                                          fill="currentColor"
                                          viewBox="0 0 20 20"
                                        >
                                          <path
                                            fillRule="evenodd"
                                            d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                                            clipRule="evenodd"
                                          />
                                        </svg>
                                        <span className="text-sm font-mono text-gray-600">
                                          {conv.id.substring(0, 8)}
                                        </span>
                                        <span className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                                          {conv.turn_count} turns
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-3 text-xs text-gray-500">
                                        <span>
                                          Started{" "}
                                          {new Date(
                                            conv.started_at
                                          ).toLocaleString()}
                                        </span>
                                        {conv.ended_at ? (
                                          <div className="flex items-center gap-2">
                                            <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                                              Ended
                                            </span>
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleResumeConversation(conv.id);
                                              }}
                                              className="inline-flex rounded-md border border-indigo-300 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 transition-colors"
                                            >
                                              Resume
                                            </button>
                                          </div>
                                        ) : (
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleEndConversation(conv.id);
                                            }}
                                            className="inline-flex rounded-md border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-100 transition-colors"
                                          >
                                            End Conversation
                                          </button>
                                        )}
                                      </div>
                                    </div>

                                    {isConvExpanded && (
                                      <div className="border-t border-gray-100 max-h-96 overflow-y-auto">
                                        {turnsLoading ? (
                                          <p className="px-4 py-3 text-sm text-gray-500">
                                            Loading turns...
                                          </p>
                                        ) : convTurns.length === 0 ? (
                                          <p className="px-4 py-3 text-sm text-gray-400 italic">
                                            No turns in this conversation.
                                          </p>
                                        ) : (
                                          <div className="divide-y divide-gray-50">
                                            {convTurns.map((turn) => (
                                              <div
                                                key={turn.id}
                                                className="px-4 py-2.5"
                                              >
                                                <div className="flex items-center gap-2 mb-0.5">
                                                  <span className="text-xs font-medium text-gray-400">
                                                    #{turn.turn_number}
                                                  </span>
                                                  <span className="text-xs font-semibold text-gray-700">
                                                    {turn.speaker_name}
                                                  </span>
                                                  <span className="text-xs text-gray-400">
                                                    {new Date(
                                                      turn.timestamp
                                                    ).toLocaleTimeString()}
                                                  </span>
                                                </div>
                                                <p className="text-sm text-gray-800 leading-relaxed">
                                                  {turn.text}
                                                </p>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
