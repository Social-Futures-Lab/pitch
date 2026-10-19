import { useState } from "react";

interface PromptBannerProps {
  topic: string;
}

export default function PromptBanner({ topic }: PromptBannerProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="sticky top-0 z-10 border-b border-indigo-200 bg-indigo-50 px-5 py-3">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 text-indigo-500">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-5 w-5"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
              clipRule="evenodd"
            />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="flex items-center gap-1 rounded px-1 -ml-1 transition-colors hover:bg-indigo-100"
            aria-label={collapsed ? "Expand discussion prompt" : "Collapse discussion prompt"}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
              Discussion Prompt
            </p>
            <span className="text-xs text-indigo-400">
              {collapsed ? "expand prompt" : "collapse prompt"}
            </span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className={`h-4 w-4 text-indigo-500 transition-transform ${collapsed ? "rotate-180" : ""}`}
            >
              <path
                fillRule="evenodd"
                d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          {!collapsed && (
            <p className="mt-0.5 text-sm leading-relaxed text-indigo-900">
              {topic}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
