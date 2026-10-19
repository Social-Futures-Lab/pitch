import { useState, useEffect, useCallback } from "react";
import { useForm } from "react-hook-form";
import {
  listExcerpts,
  updateExcerpt,
  type Excerpt,
  type UpdateExcerptPayload,
} from "@/api/admin";
import { getConversation } from "@/api/conversations";
import type { Turn } from "@/types";

export default function ExcerptEditor() {
  const [conversationId, setConversationId] = useState("");
  const [excerpts, setExcerpts] = useState<Excerpt[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<UpdateExcerptPayload>();

  const loadExcerpts = useCallback(async () => {
    if (!conversationId.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const [excerptData, convData] = await Promise.all([
        listExcerpts(conversationId),
        getConversation(conversationId),
      ]);
      setExcerpts(excerptData);
      setTurns(convData.turns ?? []);
    } catch {
      setError("Failed to load excerpts or conversation.");
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    if (conversationId.trim()) {
      loadExcerpts();
    }
  }, [conversationId, loadExcerpts]);

  const startEdit = (excerpt: Excerpt) => {
    setEditingId(excerpt.id);
    reset({
      start_turn_number: excerpt.start_turn_number,
      end_turn_number: excerpt.end_turn_number,
      preceding_context_summary: excerpt.preceding_context_summary ?? "",
      following_context_summary: excerpt.following_context_summary ?? "",
    });
  };

  const onSave = async (data: UpdateExcerptPayload) => {
    if (!editingId) return;
    setSaving(true);
    try {
      const updated = await updateExcerpt(editingId, data);
      setExcerpts((prev) =>
        prev.map((e) => (e.id === updated.id ? updated : e))
      );
      setEditingId(null);
    } catch {
      setError("Failed to update excerpt.");
    } finally {
      setSaving(false);
    }
  };

  const getPreviewTurns = (excerpt: Excerpt): Turn[] => {
    return turns.filter(
      (t) =>
        t.turn_number >= excerpt.start_turn_number &&
        t.turn_number <= excerpt.end_turn_number
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">
          Excerpt Editor
        </h2>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Conversation ID
        </label>
        <div className="flex gap-3">
          <input
            type="text"
            value={conversationId}
            onChange={(e) => setConversationId(e.target.value)}
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            placeholder="Enter conversation ID..."
          />
          <button
            onClick={loadExcerpts}
            disabled={loading || !conversationId.trim()}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50 transition-colors"
          >
            {loading ? "Loading..." : "Load"}
          </button>
        </div>
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

      {excerpts.length === 0 && conversationId && !loading && (
        <div className="rounded-lg border border-gray-200 bg-white py-12 text-center text-sm text-gray-500">
          No excerpts found for this conversation.
        </div>
      )}

      {excerpts.length > 0 && (
        <div className="space-y-4">
          {excerpts.map((excerpt) => (
            <div
              key={excerpt.id}
              className="rounded-lg border border-gray-200 bg-white overflow-hidden"
            >
              <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-5 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-mono text-gray-500">
                    {excerpt.id.substring(0, 8)}
                  </span>
                  <span className="inline-flex rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                    Turns {excerpt.start_turn_number}-{excerpt.end_turn_number}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() =>
                      setPreviewId(
                        previewId === excerpt.id ? null : excerpt.id
                      )
                    }
                    className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    {previewId === excerpt.id ? "Hide Preview" : "Preview"}
                  </button>
                  <button
                    onClick={() => startEdit(excerpt)}
                    className="rounded-md border border-indigo-300 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 transition-colors"
                  >
                    Edit
                  </button>
                </div>
              </div>

              {editingId === excerpt.id && (
                <form
                  onSubmit={handleSubmit(onSave)}
                  className="border-b border-gray-200 p-5 space-y-4 bg-blue-50/30"
                >
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Start Turn
                      </label>
                      <input
                        type="number"
                        {...register("start_turn_number", {
                          valueAsNumber: true,
                          required: "Required",
                          min: { value: 0, message: "Must be >= 0" },
                        })}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                      />
                      {errors.start_turn_number && (
                        <p className="mt-1 text-xs text-red-600">
                          {errors.start_turn_number.message}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        End Turn
                      </label>
                      <input
                        type="number"
                        {...register("end_turn_number", {
                          valueAsNumber: true,
                          required: "Required",
                          min: { value: 0, message: "Must be >= 0" },
                        })}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                      />
                      {errors.end_turn_number && (
                        <p className="mt-1 text-xs text-red-600">
                          {errors.end_turn_number.message}
                        </p>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Preceding Context Summary
                    </label>
                    <textarea
                      {...register("preceding_context_summary")}
                      rows={3}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                      placeholder="Summary of context before this excerpt..."
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Following Context Summary
                    </label>
                    <textarea
                      {...register("following_context_summary")}
                      rows={3}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                      placeholder="Summary of context after this excerpt..."
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={saving}
                      className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
                    >
                      {saving ? "Saving..." : "Save Changes"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              {excerpt.preceding_context_summary && editingId !== excerpt.id && (
                <div className="px-5 py-3 border-b border-gray-100">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
                    Context Summary
                  </p>
                  <p className="text-sm text-gray-700">
                    {excerpt.preceding_context_summary}
                  </p>
                </div>
              )}

              {previewId === excerpt.id && (
                <div className="p-5 bg-gray-50 max-h-80 overflow-y-auto">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
                    Turn Preview
                  </p>
                  {getPreviewTurns(excerpt).length === 0 ? (
                    <p className="text-sm italic text-gray-400">
                      No turns found in range.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {getPreviewTurns(excerpt).map((turn) => (
                        <div
                          key={turn.id}
                          className="rounded-md bg-white border border-gray-200 px-3 py-2"
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-medium text-gray-500">
                              #{turn.turn_number}
                            </span>
                            <span className="text-xs font-semibold text-gray-700">
                              {turn.speaker_name}
                            </span>
                          </div>
                          <p className="text-sm text-gray-800">{turn.text}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
