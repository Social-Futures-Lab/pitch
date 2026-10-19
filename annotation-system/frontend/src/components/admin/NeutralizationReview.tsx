import { useState, useEffect, useCallback } from "react";
import {
  listItems,
  reviewItem,
  neutralizeItem,
  type ReviewItem,
} from "@/api/admin";

type StatusFilter = "pending" | "approved" | "rejected" | "all";

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

export default function NeutralizationReview() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = filter === "all" ? undefined : filter;
      const data = await listItems(status);
      setItems(data);
    } catch {
      setError("Failed to load items.");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const handleAction = async (
    itemId: string,
    action: "approve" | "reject"
  ) => {
    setActionLoading(itemId);
    try {
      const updated = await reviewItem(itemId, { action });
      setItems((prev) =>
        prev.map((it) => (it.id === updated.id ? { ...it, ...updated } : it))
      );
    } catch {
      setError(`Failed to ${action} item.`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleEdit = async (itemId: string) => {
    setActionLoading(itemId);
    try {
      const updated = await reviewItem(itemId, {
        action: "edit",
        edited_neutralized_response: editText,
      });
      setItems((prev) =>
        prev.map((it) => (it.id === updated.id ? { ...it, ...updated } : it))
      );
      setEditingId(null);
      setEditText("");
    } catch {
      setError("Failed to save edit.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleNeutralize = async (itemId: string) => {
    setActionLoading(itemId);
    try {
      const updated = await neutralizeItem(itemId);
      setItems((prev) =>
        prev.map((it) => (it.id === updated.id ? { ...it, ...updated } : it))
      );
    } catch {
      setError("Failed to trigger neutralization.");
    } finally {
      setActionLoading(null);
    }
  };

  const startEdit = (item: ReviewItem) => {
    setEditingId(item.id);
    setEditText(item.neutralized_ideal_response ?? "");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">
          Items & Neutralization Review
        </h2>
        <div className="flex gap-1">
          {(["pending", "approved", "rejected", "all"] as StatusFilter[]).map(
            (f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  filter === f
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            )
          )}
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

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-sm text-gray-500">Loading items...</p>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white py-12 text-center text-sm text-gray-500">
          No items found with status "{filter}".
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <div
              key={item.id}
              className="rounded-lg border border-gray-200 bg-white overflow-hidden"
            >
              <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-5 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-mono text-gray-500">
                    {item.id.substring(0, 8)}
                  </span>
                  <span
                    className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      STATUS_BADGE[item.review_status] ??
                      "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {item.review_status}
                  </span>
                  <span className="text-xs text-gray-500 capitalize">
                    {item.contribution_type.replace(/_/g, " ")}
                  </span>
                </div>
                <span className="text-xs text-gray-400">
                  {new Date(item.created_at).toLocaleString()}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-gray-200">
                <div className="p-5">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Raw Response
                  </p>
                  <p className="whitespace-pre-wrap text-sm text-gray-800 leading-relaxed">
                    {item.raw_ideal_response}
                  </p>
                </div>
                <div className="p-5">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Neutralized Response
                  </p>
                  {editingId === item.id ? (
                    <div className="space-y-3">
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={6}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleEdit(item.id)}
                          disabled={actionLoading === item.id}
                          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
                        >
                          {actionLoading === item.id
                            ? "Saving..."
                            : "Save Edit"}
                        </button>
                        <button
                          onClick={() => {
                            setEditingId(null);
                            setEditText("");
                          }}
                          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : item.neutralized_ideal_response ? (
                    <p className="whitespace-pre-wrap text-sm text-gray-800 leading-relaxed">
                      {item.neutralized_ideal_response}
                    </p>
                  ) : (
                    <p className="text-sm italic text-gray-400">
                      Not yet neutralized
                    </p>
                  )}
                </div>
              </div>

              {item.quality_checklist &&
                Object.keys(item.quality_checklist).length > 0 && (
                  <div className="border-t border-gray-100 px-5 py-3 bg-gray-50">
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Quality Checklist
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(item.quality_checklist).map(
                        ([key, value]) => (
                          <span
                            key={key}
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                              value
                                ? "bg-green-100 text-green-700"
                                : "bg-red-100 text-red-700"
                            }`}
                          >
                            {value ? "✓" : "✗"}{" "}
                            {key.replace(/_/g, " ")}
                          </span>
                        )
                      )}
                    </div>
                  </div>
                )}

              <div className="flex items-center gap-2 border-t border-gray-100 px-5 py-3">
                {item.review_status === "pending" && (
                  <>
                    <button
                      onClick={() => handleAction(item.id, "approve")}
                      disabled={actionLoading === item.id}
                      className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-500 disabled:opacity-50 transition-colors"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleAction(item.id, "reject")}
                      disabled={actionLoading === item.id}
                      className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50 transition-colors"
                    >
                      Reject
                    </button>
                  </>
                )}
                <button
                  onClick={() => startEdit(item)}
                  disabled={actionLoading === item.id}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  Edit
                </button>
                {!item.neutralized_ideal_response && (
                  <button
                    onClick={() => handleNeutralize(item.id)}
                    disabled={actionLoading === item.id}
                    className="rounded-md border border-purple-300 bg-purple-50 px-3 py-1.5 text-xs font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-50 transition-colors"
                  >
                    {actionLoading === item.id
                      ? "Neutralizing..."
                      : "Trigger Neutralization"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
