import { useState } from "react";
import {
  triggerConsensus,
  exportPickBestTurn,
  exportTurnByTurn,
  exportPrioritized,
  exportAblation,
  exportBulk,
  exportAgreement,
  type AgreementStats,
} from "@/api/export";

const ABLATION_VARIANTS = [
  "no_context",
  "no_neutralization",
  "no_excerpt",
  "full",
] as const;

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function ExportPanel() {
  const [conversationId, setConversationId] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [agreement, setAgreement] = useState<AgreementStats | null>(null);

  const withLoading = async (key: string, fn: () => Promise<void>) => {
    setLoading(key);
    setError(null);
    try {
      await fn();
    } catch {
      setError(`Failed: ${key}`);
    } finally {
      setLoading(null);
    }
  };

  const handleConsensus = () =>
    withLoading("consensus", async () => {
      if (!conversationId.trim()) {
        setError("Enter a conversation ID to trigger consensus.");
        return;
      }
      const result = await triggerConsensus(conversationId);
      setSuccessMsg(result.message || "Consensus triggered.");
      setTimeout(() => setSuccessMsg(null), 4000);
    });

  const handleExport = (
    key: string,
    fn: () => Promise<Blob>,
    filename: string
  ) =>
    withLoading(key, async () => {
      const blob = await fn();
      downloadBlob(blob, filename);
    });

  const handleAgreement = () =>
    withLoading("agreement", async () => {
      const convId = conversationId.trim() || undefined;
      const stats = await exportAgreement(convId);
      setAgreement(stats);
    });

  const convIdOrUndefined = conversationId.trim() || undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">
          Data Export
        </h2>
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

      {successMsg && (
        <div className="rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
          {successMsg}
        </div>
      )}

      {/* Conversation ID input */}
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Conversation ID (optional, scopes exports to a single conversation)
        </label>
        <input
          type="text"
          value={conversationId}
          onChange={(e) => setConversationId(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          placeholder="Enter conversation ID..."
        />
      </div>

      {/* Consensus */}
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-800 mb-2">
          Consensus
        </h3>
        <p className="text-xs text-gray-500 mb-3">
          Trigger consensus computation for a conversation. Requires a
          conversation ID above.
        </p>
        <button
          onClick={handleConsensus}
          disabled={loading === "consensus" || !conversationId.trim()}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50 transition-colors"
        >
          {loading === "consensus"
            ? "Processing..."
            : "Trigger Consensus"}
        </button>
      </div>

      {/* Export formats */}
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-800 mb-3">
          Export Formats
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <button
            onClick={() =>
              handleExport(
                "pick-best-turn",
                () => exportPickBestTurn(convIdOrUndefined),
                "pick-best-turn.json"
              )
            }
            disabled={loading === "pick-best-turn"}
            className="flex flex-col items-start rounded-md border border-gray-200 p-4 text-left hover:border-indigo-300 hover:bg-indigo-50/50 disabled:opacity-50 transition-colors"
          >
            <span className="text-sm font-medium text-gray-900">
              Pick Best Turn
            </span>
            <span className="text-xs text-gray-500 mt-1">
              Best turn selections per item
            </span>
            {loading === "pick-best-turn" && (
              <span className="text-xs text-indigo-600 mt-1">
                Downloading...
              </span>
            )}
          </button>

          <button
            onClick={() =>
              handleExport(
                "turn-by-turn",
                () => exportTurnByTurn(convIdOrUndefined),
                "turn-by-turn.json"
              )
            }
            disabled={loading === "turn-by-turn"}
            className="flex flex-col items-start rounded-md border border-gray-200 p-4 text-left hover:border-indigo-300 hover:bg-indigo-50/50 disabled:opacity-50 transition-colors"
          >
            <span className="text-sm font-medium text-gray-900">
              Turn by Turn
            </span>
            <span className="text-xs text-gray-500 mt-1">
              Annotation data per turn
            </span>
            {loading === "turn-by-turn" && (
              <span className="text-xs text-indigo-600 mt-1">
                Downloading...
              </span>
            )}
          </button>

          <button
            onClick={() =>
              handleExport(
                "prioritized",
                () => exportPrioritized(convIdOrUndefined),
                "prioritized.json"
              )
            }
            disabled={loading === "prioritized"}
            className="flex flex-col items-start rounded-md border border-gray-200 p-4 text-left hover:border-indigo-300 hover:bg-indigo-50/50 disabled:opacity-50 transition-colors"
          >
            <span className="text-sm font-medium text-gray-900">
              Prioritized
            </span>
            <span className="text-xs text-gray-500 mt-1">
              Priority-ranked annotations
            </span>
            {loading === "prioritized" && (
              <span className="text-xs text-indigo-600 mt-1">
                Downloading...
              </span>
            )}
          </button>

          {ABLATION_VARIANTS.map((variant) => (
            <button
              key={variant}
              onClick={() =>
                handleExport(
                  `ablation-${variant}`,
                  () => exportAblation(variant),
                  `ablation-${variant}.json`
                )
              }
              disabled={loading === `ablation-${variant}`}
              className="flex flex-col items-start rounded-md border border-gray-200 p-4 text-left hover:border-indigo-300 hover:bg-indigo-50/50 disabled:opacity-50 transition-colors"
            >
              <span className="text-sm font-medium text-gray-900">
                Ablation: {variant.replace(/_/g, " ")}
              </span>
              <span className="text-xs text-gray-500 mt-1">
                Ablation study variant
              </span>
              {loading === `ablation-${variant}` && (
                <span className="text-xs text-indigo-600 mt-1">
                  Downloading...
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Bulk export */}
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-800 mb-3">
          Bulk Export
        </h3>
        <div className="flex gap-3">
          <button
            onClick={() =>
              handleExport(
                "bulk-json",
                () => exportBulk("json"),
                "bulk-export.json"
              )
            }
            disabled={loading === "bulk-json"}
            className="rounded-md bg-gray-800 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            {loading === "bulk-json"
              ? "Exporting..."
              : "Export JSON"}
          </button>
          <button
            onClick={() =>
              handleExport(
                "bulk-csv",
                () => exportBulk("csv"),
                "bulk-export.csv"
              )
            }
            disabled={loading === "bulk-csv"}
            className="rounded-md bg-gray-800 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            {loading === "bulk-csv"
              ? "Exporting..."
              : "Export CSV"}
          </button>
        </div>
      </div>

      {/* Agreement stats */}
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-800 mb-3">
          Agreement Statistics
        </h3>
        <button
          onClick={handleAgreement}
          disabled={loading === "agreement"}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50 transition-colors mb-4"
        >
          {loading === "agreement"
            ? "Loading..."
            : "Compute Agreement"}
        </button>

        {agreement && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
            <div className="rounded-md border border-gray-200 bg-gray-50 p-4 text-center">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Cohen's Kappa
              </p>
              <p className="mt-1 text-2xl font-bold text-gray-900">
                {agreement.cohens_kappa.toFixed(3)}
              </p>
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50 p-4 text-center">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Percent Agreement
              </p>
              <p className="mt-1 text-2xl font-bold text-gray-900">
                {(agreement.percent_agreement * 100).toFixed(1)}%
              </p>
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50 p-4 text-center">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Annotations
              </p>
              <p className="mt-1 text-2xl font-bold text-gray-900">
                {agreement.n_annotations}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
