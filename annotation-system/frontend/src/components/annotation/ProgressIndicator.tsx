interface ProgressIndicatorProps {
  completed: number;
  total: number;
  currentIndex: number;
  onPrevious: () => void;
  onNext: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
  disableNext?: boolean;
}

export default function ProgressIndicator({
  completed,
  total,
  currentIndex,
  onPrevious,
  onNext,
  hasPrevious,
  hasNext,
  disableNext = false,
}: ProgressIndicatorProps) {
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="flex items-center gap-4">
      {/* Navigation buttons */}
      <button
        onClick={onPrevious}
        disabled={!hasPrevious}
        className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
        title="Previous item"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          className="h-3.5 w-3.5"
        >
          <path
            fillRule="evenodd"
            d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z"
            clipRule="evenodd"
          />
        </svg>
        Prev
      </button>

      {/* Progress info */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-between text-xs text-gray-600">
          <span>
            Item {currentIndex + 1} of {total}
          </span>
          <span>
            {completed} of {total} complete ({percentage}%)
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
          <div
            className="h-full rounded-full bg-indigo-500 transition-all duration-300"
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>

      {/* Next button */}
      <button
        onClick={onNext}
        disabled={!hasNext || disableNext}
        className="inline-flex items-center gap-1 rounded-md bg-gray-700 px-2.5 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-gray-600 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500"
        title={disableNext ? "Complete all required fields to continue" : "Next item"}
      >
        Next
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          className="h-3.5 w-3.5"
        >
          <path
            fillRule="evenodd"
            d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>
    </div>
  );
}
