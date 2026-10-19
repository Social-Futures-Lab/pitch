import { useState, useEffect, useCallback } from "react";
import { useForm } from "react-hook-form";
import {
  listPrompts,
  createPrompt,
  type Prompt,
  type CreatePromptPayload,
} from "@/api/admin";

const SCENARIOS = ["scholar", "trip"] as const;

export default function PromptManager() {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting, errors },
  } = useForm<CreatePromptPayload>();

  const loadPrompts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listPrompts();
      setPrompts(data);
    } catch {
      setError("Failed to load prompts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPrompts();
  }, [loadPrompts]);

  const onCreatePrompt = async (data: CreatePromptPayload) => {
    try {
      const newPrompt = await createPrompt(data);
      setPrompts((prev) => [newPrompt, ...prev]);
      setShowForm(false);
      reset();
    } catch {
      setError("Failed to create prompt.");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-gray-500">Loading prompts...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Prompts</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 transition-colors"
        >
          {showForm ? "Cancel" : "Create Prompt"}
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
          onSubmit={handleSubmit(onCreatePrompt)}
          className="rounded-lg border border-gray-200 bg-white p-5 space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Scenario <span className="text-red-500">*</span>
            </label>
            <select
              {...register("scenario", { required: "Scenario is required" })}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            >
              <option value="">Select a scenario...</option>
              {SCENARIOS.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
            {errors.scenario && (
              <p className="mt-1 text-xs text-red-600">
                {errors.scenario.message}
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Prompt Text <span className="text-red-500">*</span>
            </label>
            <textarea
              {...register("text", { required: "Prompt text is required" })}
              rows={6}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              placeholder="Enter the prompt text for participants..."
            />
            {errors.text && (
              <p className="mt-1 text-xs text-red-600">{errors.text.message}</p>
            )}
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50 transition-colors"
            >
              {isSubmitting ? "Creating..." : "Create Prompt"}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Scenario
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Text Preview
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Created
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {prompts.length === 0 && (
              <tr>
                <td
                  colSpan={3}
                  className="px-4 py-8 text-center text-sm text-gray-500"
                >
                  No prompts yet. Create one to get started.
                </td>
              </tr>
            )}
            {prompts.map((prompt) => (
              <tr key={prompt.id} className="hover:bg-gray-50">
                <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900 capitalize">
                  {prompt.scenario}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700 max-w-md">
                  <p className="line-clamp-2">{prompt.text}</p>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                  {new Date(prompt.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
