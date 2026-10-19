import { useState, useCallback, Suspense, lazy } from "react";

const GroupManager = lazy(
  () => import("@/components/admin/GroupManager")
);
const NeutralizationReview = lazy(
  () => import("@/components/admin/NeutralizationReview")
);
const UserManager = lazy(
  () => import("@/components/admin/UserManager")
);
const PromptManager = lazy(
  () => import("@/components/admin/PromptManager")
);
const ExcerptEditor = lazy(
  () => import("@/components/admin/ExcerptEditor")
);
const ExportPanel = lazy(
  () => import("@/components/admin/ExportPanel")
);

interface Tab {
  id: string;
  label: string;
}

const TABS: Tab[] = [
  { id: "groups", label: "Study Groups" },
  { id: "items", label: "Items & Review" },
  { id: "users", label: "Users" },
  { id: "prompts", label: "Prompts" },
  { id: "excerpts", label: "Excerpts" },
  { id: "export", label: "Export" },
];

function getInitialTab(): string {
  const hash = window.location.hash.replace("#", "");
  if (TABS.some((t) => t.id === hash)) return hash;
  return "groups";
}

function TabFallback() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <svg
          className="h-4 w-4 animate-spin text-indigo-500"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
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
        Loading...
      </div>
    </div>
  );
}

function TabContent({ tabId }: { tabId: string }) {
  switch (tabId) {
    case "groups":
      return <GroupManager />;
    case "items":
      return <NeutralizationReview />;
    case "users":
      return <UserManager />;
    case "prompts":
      return <PromptManager />;
    case "excerpts":
      return <ExcerptEditor />;
    case "export":
      return <ExportPanel />;
    default:
      return null;
  }
}

export default function AdminDashboardPage() {
  const [activeTab, setActiveTab] = useState(getInitialTab);

  const switchTab = useCallback((tabId: string) => {
    setActiveTab(tabId);
    window.location.hash = tabId;
  }, []);

  return (
    <div className="mx-auto max-w-7xl">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">
        Admin Dashboard
      </h1>

      {/* Tab navigation */}
      <div className="mb-6 border-b border-gray-200">
        <nav className="-mb-px flex gap-0 overflow-x-auto" aria-label="Tabs">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => switchTab(tab.id)}
                className={`shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "border-indigo-600 text-indigo-600"
                    : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab content */}
      <Suspense fallback={<TabFallback />}>
        <TabContent tabId={activeTab} />
      </Suspense>
    </div>
  );
}
