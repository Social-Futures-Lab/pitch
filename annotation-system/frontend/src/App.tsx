import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense } from "react";
import { AuthProvider } from "@/hooks/useAuth";
import ProtectedRoute from "@/components/common/ProtectedRoute";
import Layout from "@/components/common/Layout";
import LoginPage from "@/pages/LoginPage";
import MyGroupsPage from "@/pages/MyGroupsPage";
import ConversationPage from "@/pages/ConversationPage";
import ConstructionPage from "@/pages/ConstructionPage";
import CrossAnnotationPage from "@/pages/CrossAnnotationPage";
import DeliberationPage from "@/pages/DeliberationPage";
import DeliberationListPage from "@/pages/DeliberationListPage";
import DeliberationSummaryPage from "@/pages/DeliberationSummaryPage";
import RankingDeliberationPage from "@/pages/RankingDeliberationPage";
import RankingDeliberationListPage from "@/pages/RankingDeliberationListPage";
import RankingDeliberationSummaryPage from "@/pages/RankingDeliberationSummaryPage";
import AdminDashboardPage from "@/pages/AdminDashboardPage";

const TutorialLayout = lazy(() => import("@/tutorial/TutorialLayout"));
const TutorialConversationPage = lazy(() => import("@/tutorial/pages/TutorialConversationPage"));
const TutorialConstructionPage = lazy(() => import("@/tutorial/pages/TutorialConstructionPage"));
const TutorialAnnotationPage = lazy(() => import("@/tutorial/pages/TutorialAnnotationPage"));
const TutorialDeliberationPage = lazy(() => import("@/tutorial/pages/TutorialDeliberationPage"));

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<Navigate to="/login" replace />} />

          {/* Tutorial routes - no auth required */}
          <Route
            path="/tutorial/interactive"
            element={
              <Suspense fallback={<div className="flex h-screen items-center justify-center text-gray-500">Loading tutorial...</div>}>
                <TutorialLayout />
              </Suspense>
            }
          >
            <Route index element={<Navigate to="conversation" replace />} />
            <Route path="conversation" element={<Suspense fallback={null}><TutorialConversationPage /></Suspense>} />
            <Route path="construction" element={<Suspense fallback={null}><TutorialConstructionPage /></Suspense>} />
            <Route path="annotation" element={<Suspense fallback={null}><TutorialAnnotationPage /></Suspense>} />
            <Route path="deliberation" element={<Suspense fallback={null}><TutorialDeliberationPage /></Suspense>} />
          </Route>

          {/* Participant routes */}
          <Route
            element={
              <ProtectedRoute
                allowedRoles={["participant"]}
              />
            }
          >
            <Route element={<Layout />}>
              <Route path="/my-groups" element={<MyGroupsPage />} />
              <Route
                path="/conversation/:conversationId"
                element={<ConversationPage />}
              />
              <Route
                path="/construction/:conversationId"
                element={<ConstructionPage />}
              />
            </Route>
          </Route>

          {/* Annotation routes (participant + external_annotator) */}
          <Route
            element={
              <ProtectedRoute
                allowedRoles={["participant", "external_annotator"]}
              />
            }
          >
            <Route element={<Layout />}>
              <Route path="/annotation" element={<CrossAnnotationPage />} />
              <Route
                path="/annotation/:excerptId"
                element={<CrossAnnotationPage />}
              />
              <Route path="/deliberation" element={<DeliberationListPage />} />
              <Route
                path="/deliberation/summary"
                element={<DeliberationSummaryPage />}
              />
              <Route
                path="/deliberation/:excerptId"
                element={<DeliberationPage />}
              />
              <Route path="/ranking-deliberation" element={<RankingDeliberationListPage />} />
              <Route
                path="/ranking-deliberation/summary"
                element={<RankingDeliberationSummaryPage />}
              />
              <Route
                path="/ranking-deliberation/:excerptId"
                element={<RankingDeliberationPage />}
              />
            </Route>
          </Route>

          {/* Researcher / admin routes */}
          <Route
            element={
              <ProtectedRoute
                allowedRoles={["researcher"]}
              />
            }
          >
            <Route element={<Layout />}>
              <Route path="/admin/*" element={<AdminDashboardPage />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
