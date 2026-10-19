import { Outlet, Link, useLocation } from "react-router-dom";
import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";

interface NavItem {
  label: string;
  path: string;
}

function getNavItems(role: string): NavItem[] {
  switch (role) {
    case "participant":
      return [
        { label: "My Groups", path: "/my-groups" },
      ];
    case "external_annotator":
      return [{ label: "Annotation", path: "/annotation" }];
    case "researcher":
      return [{ label: "Admin Dashboard", path: "/admin" }];
    default:
      return [];
  }
}

interface TutorialStage {
  id: string;
  title: string;
  content: string;
}

const TUTORIAL_STAGES: TutorialStage[] = [
  {
    id: "goal",
    title: "Goal",
    content:
      "You'll have a group conversation, then retrospectively think about what additional information would have made it better. That information takes the form of inserted messages — imagine a knowledgeable participant dropping in a helpful fact, reference, or suggestion at just the right moment.",
  },
  {
    id: "stage-1",
    title: "Stage 1: Conversation",
    content:
      "Have a genuine discussion on the prompt your group receives. Bookmark any message where you think outside knowledge could help — hover and click the Bookmark icon. Bookmarks are private memory aids for the next stage.",
  },
  {
    id: "stage-2",
    title: "Stage 2: Create Messages",
    content:
      "Review your transcript and create inserted messages. For each: choose a placement window (first relevant / last useful / best placement turn), pick a direction, search for sources, rate importance, then write or generate the message.",
  },
  {
    id: "stage-3",
    title: "Stage 3: Annotate",
    content:
      "You'll see messages your groupmates created. For each, either place it (select placement window + rate importance) or mark \"Should not appear.\" After all messages, rank them from most to least valuable, then submit.",
  },
  {
    id: "stage-4",
    title: "Stage 4: Review & Revise",
    content:
      "Part A: See colored overlays showing where others placed each message. Revise your placements, importance, or keep them. Part B: Compare your ranking with peers and revise if needed, then save and complete the review.",
  },
];

function getActiveStageForPath(pathname: string): string {
  if (pathname.startsWith("/conversation/")) return "stage-1";
  if (pathname.startsWith("/construction/")) return "stage-2";
  if (pathname.startsWith("/annotation")) return "stage-3";
  if (pathname.startsWith("/deliberation") || pathname.startsWith("/ranking-deliberation")) return "stage-4";
  return "goal";
}

function TutorialPreview({
  activeStageId,
  visible,
}: {
  activeStageId: string;
  visible: boolean;
}) {
  const activeIdx = TUTORIAL_STAGES.findIndex((s) => s.id === activeStageId);

  if (!visible) return null;

  return (
    <div className="absolute left-full top-0 z-50 ml-2 w-80" style={{ animation: "fadeSlideIn 150ms ease-out" }}>
      <div className="rounded-lg border border-gray-200 bg-white shadow-lg overflow-hidden">
        {/* Header */}
        <div className="border-b border-gray-100 bg-gray-50 px-4 py-2.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Tutorial Preview
          </p>
        </div>

        {/* Stage list */}
        <div className="p-2">
          {TUTORIAL_STAGES.map((stage, idx) => {
            const isActive = idx === activeIdx;
            return (
              <div
                key={stage.id}
                className={`rounded-md px-3 py-2.5 transition-colors ${
                  isActive ? "bg-indigo-50 border border-indigo-200" : "border border-transparent"
                }`}
              >
                <p
                  className={`text-xs font-semibold ${
                    isActive ? "text-indigo-700" : "text-gray-600"
                  }`}
                >
                  {stage.title}
                  {isActive && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">
                      You are here
                    </span>
                  )}
                </p>
                {isActive && (
                  <p className="mt-1.5 text-xs leading-relaxed text-gray-600">
                    {stage.content}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 px-4 py-2.5">
          <p className="text-[11px] text-gray-400">
            Click to open the full tutorial in a new tab
          </p>
        </div>
      </div>
    </div>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();

  const navItems = user ? getNavItems(user.role) : [];
  const activeStageId = getActiveStageForPath(location.pathname);

  const [showPreview, setShowPreview] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = () => {
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = null;
    }
    hoverTimeoutRef.current = setTimeout(() => setShowPreview(true), 300);
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    leaveTimeoutRef.current = setTimeout(() => setShowPreview(false), 200);
  };

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
      if (leaveTimeoutRef.current) clearTimeout(leaveTimeoutRef.current);
    };
  }, []);

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6">
        <div className="flex items-center gap-6">
          <Link to="/" className="text-lg font-semibold text-gray-900">
            PITCH Annotation
          </Link>
        </div>
        {user && (
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">
              {user.name}{" "}
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                {user.role}
              </span>
            </span>
            <button
              onClick={logout}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
            >
              Log out
            </button>
          </div>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">
        {navItems.length > 0 && (
          <nav className="flex w-56 shrink-0 flex-col border-r border-gray-200 bg-white p-4">
            <ul className="flex flex-col gap-1">
              {navItems.map((item) => {
                const isActive = location.pathname.startsWith(item.path);
                return (
                  <li key={item.path}>
                    <Link
                      to={item.path}
                      className={`block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                        isActive
                          ? "bg-blue-50 text-blue-700"
                          : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                      }`}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}

              {/* Tutorial link — directly below nav items */}
              <li
                className="relative"
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
              >
                <a
                  href={`/tutorial.html#${activeStageId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-gray-400">
                    <path d="M10.75 16.82A7.462 7.462 0 0 1 15 15.5c.71 0 1.396.098 2.046.282A.75.75 0 0 0 18 15.06v-11a.75.75 0 0 0-.546-.721A9.006 9.006 0 0 0 15 3a8.963 8.963 0 0 0-4.25 1.065V16.82ZM9.25 4.065A8.963 8.963 0 0 0 5 3c-.85 0-1.673.118-2.454.339A.75.75 0 0 0 2 4.06v11a.75.75 0 0 0 .954.721A7.506 7.506 0 0 1 5 15.5c1.579 0 3.042.487 4.25 1.32V4.065Z" />
                  </svg>
                  Tutorial
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3 shrink-0 text-gray-300">
                    <path fillRule="evenodd" d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                  </svg>
                </a>
                <TutorialPreview
                  activeStageId={activeStageId}
                  visible={showPreview}
                />
              </li>
            </ul>
          </nav>
        )}

        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
