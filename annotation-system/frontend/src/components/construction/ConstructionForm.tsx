import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import type { KnowledgeItem } from "@/types";
import type { PlacementWindow } from "./TranscriptReview";
import { getAiSuggestion } from "@/api/construction";

interface FormValues {
  raw_ideal_response: string;
  contribution_type: string;
  contribution_type_detail: string;
  pertinence: number;
}

const CONTRIBUTION_TYPES = [
  { value: "heads_up", label: "Heads up" },
  { value: "pushback", label: "Pushback" },
  { value: "support", label: "Support" },
  { value: "suggestion", label: "Suggestion" },
  { value: "others", label: "Others" },
];

interface ConstructionFormProps {
  item: KnowledgeItem | null;
  placementWindow: PlacementWindow;
  onSave: (data: Partial<KnowledgeItem>) => Promise<void>;
  saving: boolean;
}

export default function ConstructionForm({
  item,
  placementWindow,
  onSave,
  saving,
}: ConstructionFormProps) {
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      raw_ideal_response: "",
      contribution_type: "heads_up",
      contribution_type_detail: "",
      pertinence: 0.5,
    },
  });

  const pertinenceValue = watch("pertinence");
  const contributionType = watch("contribution_type");

  // Reset form when item changes
  useEffect(() => {
    if (item) {
      reset({
        raw_ideal_response: item.raw_ideal_response,
        contribution_type: item.contribution_type || "heads_up",
        contribution_type_detail: item.contribution_type_detail || "",
        pertinence: item.pertinence ?? 0.5,
      });
    } else {
      reset({
        raw_ideal_response: "",
        contribution_type: "heads_up",
        contribution_type_detail: "",
        pertinence: 0.5,
      });
    }
  }, [item, reset]);

  const onSubmit = async (data: FormValues) => {
    await onSave({
      raw_ideal_response: data.raw_ideal_response,
      contribution_type: data.contribution_type,
      contribution_type_detail: data.contribution_type === "others" ? data.contribution_type_detail : undefined,
      pertinence: data.pertinence,
      window_start_turn_number: placementWindow.startTurn ?? 0,
      window_end_turn_number: placementWindow.endTurn ?? 0,
      best_turn_number: placementWindow.bestTurn ?? 0,
    });
  };

  const handleAiSuggest = async () => {
    if (!item?.id) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const result = await getAiSuggestion(item.id);
      setValue("raw_ideal_response", result.suggestion, {
        shouldDirty: true,
      });
    } catch {
      setAiError("Failed to get AI suggestion. Please try again.");
    } finally {
      setAiLoading(false);
    }
  };

  const getPertinenceLabel = (value: number) => {
    if (value <= 0.33) return "Nice to know";
    if (value <= 0.66) return "Useful";
    return "Essential";
  };

  const windowReady =
    placementWindow.startTurn !== null &&
    placementWindow.endTurn !== null &&
    placementWindow.bestTurn !== null;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
      {/* Window status */}
      <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Placement Window
        </p>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            <span className="text-gray-600">Start:</span>
            <span className="font-mono font-semibold text-gray-800">
              {placementWindow.startTurn !== null
                ? `#${placementWindow.startTurn}`
                : "--"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-red-500" />
            <span className="text-gray-600">End:</span>
            <span className="font-mono font-semibold text-gray-800">
              {placementWindow.endTurn !== null
                ? `#${placementWindow.endTurn}`
                : "--"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <span className="text-gray-600">Best:</span>
            <span className="font-mono font-semibold text-gray-800">
              {placementWindow.bestTurn !== null
                ? `#${placementWindow.bestTurn}`
                : "--"}
            </span>
          </div>
        </div>
        {!windowReady && (
          <p className="mt-2 text-xs text-amber-600">
            Select start, end, and best turns in the transcript to complete the
            placement window.
          </p>
        )}
      </div>

      {/* Ideal response */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label
            htmlFor="ideal-response"
            className="block text-sm font-medium text-gray-700"
          >
            Ideal Agent Response
          </label>
          {item?.id && (
            <button
              type="button"
              onClick={handleAiSuggest}
              disabled={aiLoading}
              className="inline-flex items-center gap-1.5 rounded-md bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 transition-colors hover:bg-violet-100 disabled:opacity-50"
            >
              {aiLoading ? (
                <>
                  <svg
                    className="h-3.5 w-3.5 animate-spin"
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
                  Generating...
                </>
              ) : (
                <>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="h-3.5 w-3.5"
                  >
                    <path d="M15.98 1.804a1 1 0 00-1.96 0l-.24 1.192a1 1 0 01-.784.784l-1.192.24a1 1 0 000 1.96l1.192.24a1 1 0 01.784.784l.24 1.192a1 1 0 001.96 0l.24-1.192a1 1 0 01.784-.784l1.192-.24a1 1 0 000-1.96l-1.192-.24a1 1 0 01-.784-.784l-.24-1.192zM5.98 7.804a1 1 0 00-1.96 0l-.24 1.192a1 1 0 01-.784.785l-1.192.24a1 1 0 000 1.958l1.192.24a1 1 0 01.784.785l.24 1.192a1 1 0 001.96 0l.24-1.192a1 1 0 01.784-.785l1.192-.24a1 1 0 000-1.958l-1.192-.24a1 1 0 01-.784-.785l-.24-1.192z" />
                  </svg>
                  Suggest with AI
                </>
              )}
            </button>
          )}
        </div>
        {aiError && (
          <p className="mb-1.5 text-xs text-red-600">{aiError}</p>
        )}
        <textarea
          id="ideal-response"
          rows={6}
          placeholder="Write the ideal response an AI agent could have provided at this point in the conversation..."
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          {...register("raw_ideal_response", {
            required: "Ideal response is required",
          })}
        />
        {errors.raw_ideal_response && (
          <p className="mt-1 text-xs text-red-600">
            {errors.raw_ideal_response.message}
          </p>
        )}
      </div>

      {/* Contribution type */}
      <div>
        <label
          htmlFor="contribution-type"
          className="mb-1.5 block text-sm font-medium text-gray-700"
        >
          Contribution Type
        </label>
        <select
          id="contribution-type"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          {...register("contribution_type", {
            required: "Contribution type is required",
          })}
        >
          {CONTRIBUTION_TYPES.map((ct) => (
            <option key={ct.value} value={ct.value}>
              {ct.label}
            </option>
          ))}
        </select>
        {errors.contribution_type && (
          <p className="mt-1 text-xs text-red-600">
            {errors.contribution_type.message}
          </p>
        )}
      </div>

      {/* Contribution type detail - shown only when "others" is selected */}
      {contributionType === "others" && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
          <label
            htmlFor="contribution-type-detail"
            className="mb-1.5 block text-sm font-medium text-gray-700"
          >
            Please specify the contribution type{" "}
            <span className="text-red-600">*</span>
          </label>
          <input
            type="text"
            id="contribution-type-detail"
            placeholder="e.g., Clarification, Summary, Question..."
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            {...register("contribution_type_detail", {
              required:
                contributionType === "others"
                  ? "Please specify the contribution type"
                  : false,
            })}
          />
          {errors.contribution_type_detail && (
            <p className="mt-1 text-xs text-red-600">
              {errors.contribution_type_detail.message}
            </p>
          )}
        </div>
      )}

      {/* Pertinence slider */}
      <div>
        <label
          htmlFor="pertinence"
          className="mb-1.5 block text-sm font-medium text-gray-700"
        >
          Pertinence
        </label>
        <input
          type="range"
          id="pertinence"
          min={0}
          max={1}
          step={0.01}
          className="w-full accent-indigo-600"
          {...register("pertinence", { valueAsNumber: true })}
        />
        <div className="mt-1 flex items-center justify-between text-xs text-gray-500">
          <span>Nice to know</span>
          <span className="font-semibold text-indigo-600">
            {getPertinenceLabel(pertinenceValue)} ({pertinenceValue.toFixed(2)})
          </span>
          <span>Essential</span>
        </div>
      </div>

      {/* Save button */}
      <button
        type="submit"
        disabled={saving || !windowReady}
        className="rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? "Saving..." : item?.id ? "Update Item" : "Save Item"}
      </button>
    </form>
  );
}
