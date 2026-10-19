import type { Annotation } from "@/types";
import { PERTINENCE_LABELS } from "@/constants";

interface DiffIndicatorProps {
  original: Annotation | null;
  current: {
    window_start_turn_number: number | null;
    window_end_turn_number: number | null;
    best_turn_number: number | null;
    do_not_surface: boolean;
    pertinence: number | null;
  };
}

interface DiffLine {
  label: string;
  oldValue: string;
  newValue: string;
  changed: boolean;
}

function formatTurn(val: number | null): string {
  return val !== null ? `#${val}` : "--";
}

function formatBool(val: boolean): string {
  return val ? "Yes" : "No";
}

function formatPertinence(val: number | null | undefined): string {
  if (val == null || val < 0) return "--";
  return PERTINENCE_LABELS[val] ?? String(val);
}

export default function DiffIndicator({
  original,
  current,
}: DiffIndicatorProps) {
  if (!original) {
    return null;
  }

  const diffs: DiffLine[] = [
    {
      label: "Do not surface",
      oldValue: formatBool(original.do_not_surface),
      newValue: formatBool(current.do_not_surface),
      changed: original.do_not_surface !== current.do_not_surface,
    },
    {
      label: "Window start",
      oldValue: formatTurn(original.window_start_turn_number),
      newValue: formatTurn(current.window_start_turn_number),
      changed:
        original.window_start_turn_number !== current.window_start_turn_number,
    },
    {
      label: "Window end",
      oldValue: formatTurn(original.window_end_turn_number),
      newValue: formatTurn(current.window_end_turn_number),
      changed:
        original.window_end_turn_number !== current.window_end_turn_number,
    },
    {
      label: "Best turn",
      oldValue: formatTurn(original.best_turn_number),
      newValue: formatTurn(current.best_turn_number),
      changed: original.best_turn_number !== current.best_turn_number,
    },
    {
      label: "Importance",
      oldValue: formatPertinence(original.pertinence),
      newValue: formatPertinence(current.pertinence),
      changed: (original.pertinence ?? -1) !== (current.pertinence ?? -1),
    },
  ];

  const hasChanges = diffs.some((d) => d.changed);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Changes from Original
      </p>

      {!hasChanges ? (
        <p className="text-sm text-gray-400">No changes yet.</p>
      ) : (
        <div className="space-y-1.5">
          {diffs
            .filter((d) => d.changed)
            .map((d) => (
              <div
                key={d.label}
                className="flex items-center gap-2 text-sm"
              >
                <span className="w-28 shrink-0 text-gray-600">{d.label}</span>
                <span className="inline-flex items-center rounded bg-red-50 px-1.5 py-0.5 font-mono text-xs text-red-700 line-through">
                  {d.oldValue}
                </span>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  className="h-3 w-3 shrink-0 text-gray-400"
                >
                  <path
                    fillRule="evenodd"
                    d="M2 8a.75.75 0 01.75-.75h8.69L8.22 4.03a.75.75 0 011.06-1.06l4.5 4.5a.75.75 0 010 1.06l-4.5 4.5a.75.75 0 01-1.06-1.06l3.22-3.22H2.75A.75.75 0 012 8z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="inline-flex items-center rounded bg-green-50 px-1.5 py-0.5 font-mono text-xs text-green-700">
                  {d.newValue}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
