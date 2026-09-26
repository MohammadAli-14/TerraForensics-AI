import React, { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { AuthProvider } from "@/AuthContext";
import PrivateRoute, {
  AdminRoute,
  ManagerRoute,
} from "@/components/PrivateRoute";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import Login from "@/pages/Login";
import SimpleSSOPassthrough from "@/pages/Login/SSO/simple";
import OnboardingFlow from "@/pages/OnboardingFlow";
import i18n from "./i18n";

import { PfpProvider } from "./PfpContext";
import { LogoProvider } from "./LogoContext";
import { FullScreenLoader } from "./components/Preloader";
import { ThemeProvider } from "./ThemeContext";
import { PWAModeProvider } from "./PWAContext";
import KeyboardShortcutsHelp from "@/components/KeyboardShortcutsHelp";
import ErrorBoundary from "@/components/ErrorBoundary";

const Main = lazy(() => import("@/pages/Main"));
const InvitePage = lazy(() => import("@/pages/Invite"));
const WorkspaceChat = lazy(() => import("@/pages/WorkspaceChat"));
const AdminUsers = lazy(() => import("@/pages/Admin/Users"));
const AdminInvites = lazy(() => import("@/pages/Admin/Invitations"));
const AdminWorkspaces = lazy(() => import("@/pages/Admin/Workspaces"));
const AdminLogs = lazy(() => import("@/pages/Admin/Logging"));
const AdminAgents = lazy(() => import("@/pages/Admin/Agents"));
const GeneralChats = lazy(() => import("@/pages/GeneralSettings/Chats"));
const InterfaceSettings = lazy(
  () => import("@/pages/GeneralSettings/Settings/Interface")
);
const BrandingSettings = lazy(
  () => import("@/pages/GeneralSettings/Settings/Branding")
);

const ChatSettings = lazy(
  () => import("@/pages/GeneralSettings/Settings/Chat")
);

const GeneralApiKeys = lazy(() => import("@/pages/GeneralSettings/ApiKeys"));
const GeneralLLMPreference = lazy(
  () => import("@/pages/GeneralSettings/LLMPreference")
);
const GeneralTranscriptionPreference = lazy(
  () => import("@/pages/GeneralSettings/TranscriptionPreference")
);
const GeneralAudioPreference = lazy(
  () => import("@/pages/GeneralSettings/AudioPreference")
);
const GeneralEmbeddingPreference = lazy(
  () => import("@/pages/GeneralSettings/EmbeddingPreference")
);
const EmbeddingTextSplitterPreference = lazy(
  () => import("@/pages/GeneralSettings/EmbeddingTextSplitterPreference")
);
const GeneralVectorDatabase = lazy(
  () => import("@/pages/GeneralSettings/VectorDatabase")
);
const GeneralSecurity = lazy(() => import("@/pages/GeneralSettings/Security"));
const GeneralBrowserExtension = lazy(
  () => import("@/pages/GeneralSettings/BrowserExtensionApiKey")
);
const WorkspaceSettings = lazy(() => import("@/pages/WorkspaceSettings"));
const WorkspaceGTDMap = lazy(() => import("@/pages/WorkspaceGTDMap"));
const SovereignEngineSettings = lazy(
  () => import("@/pages/GeneralSettings/SovereignEngine")
);

const PrivacyAndData = lazy(
  () => import("@/pages/GeneralSettings/PrivacyAndData")
);
const SystemPromptVariables = lazy(
  () => import("@/pages/Admin/SystemPromptVariables")
);
const DefaultSystemPrompt = lazy(
  () => import("@/pages/Admin/DefaultSystemPrompt")
);

export default function App() {
  return (
    <ThemeProvider>
      <PWAModeProvider>
        <Suspense fallback={<FullScreenLoader />}>
          <AuthProvider>
            <LogoProvider>
              <PfpProvider>
                <I18nextProvider i18n={i18n}>
                  <ErrorBoundary>
                    <Routes>
                      <Route
                        path="/"
                        element={<PrivateRoute Component={Main} />}
                      />
                      <Route path="/login" element={<Login />} />
                      <Route
                        path="/sso/simple"
                        element={<SimpleSSOPassthrough />}
                      />

                      <Route
                        path="/workspace/:slug/settings/:tab"
                        element={<ManagerRoute Component={WorkspaceSettings} />}
                      />
                      <Route
                        path="/workspace/:slug"
                        element={<PrivateRoute Component={WorkspaceChat} />}
                      />
                      <Route
                        path="/workspace/:slug/gtd-map"
                        element={<PrivateRoute Component={WorkspaceGTDMap} />}
                      />
                      <Route
                        path="/workspace/:slug/t/:threadSlug"
                        element={<PrivateRoute Component={WorkspaceChat} />}
                      />
                      <Route
                        path="/accept-invite/:code"
                        element={<InvitePage />}
                      />

                      {/* Admin */}
                      <Route
                        path="/settings/users"
                        element={<AdminRoute Component={AdminUsers} />}
                      />
                      <Route
                        path="/settings/invites"
                        element={<AdminRoute Component={AdminInvites} />}
                      />
                      <Route
                        path="/settings/workspaces/new"
                        element={<AdminRoute Component={AdminWorkspaces} />}
                      />
                      <Route
                        path="/settings/workspace-chats"
                        element={<AdminRoute Component={GeneralChats} />}
                      />
                      <Route
                        path="/settings/system-prompt-variables"
                        element={
                          <AdminRoute Component={SystemPromptVariables} />
                        }
                      />
                      <Route
                        path="/settings/default-system-prompt"
                        element={<AdminRoute Component={DefaultSystemPrompt} />}
                      />

                      {/* Manager */}
                      <Route
                        path="/settings/agents"
                        element={<ManagerRoute Component={AdminAgents} />}
                      />
                      <Route
                        path="/settings/llm-preference"
                        element={
                          <ManagerRoute Component={GeneralLLMPreference} />
                        }
                      />
                      <Route
                        path="/settings/transcription-preference"
                        element={
                          <ManagerRoute
                            Component={GeneralTranscriptionPreference}
                          />
                        }
                      />
                      <Route
                        path="/settings/audio-preference"
                        element={
                          <ManagerRoute Component={GeneralAudioPreference} />
                        }
                      />
                      <Route
                        path="/settings/embedding-preference"
                        element={
                          <ManagerRoute
                            Component={GeneralEmbeddingPreference}
                          />
                        }
                      />
                      <Route
                        path="/settings/text-splitter-preference"
                        element={
                          <ManagerRoute
                            Component={EmbeddingTextSplitterPreference}
                          />
                        }
                      />
                      <Route
                        path="/settings/vector-database"
                        element={
                          <ManagerRoute Component={GeneralVectorDatabase} />
                        }
                      />
                      <Route
                        path="/settings/event-logs"
                        element={<AdminRoute Component={AdminLogs} />}
                      />
                      <Route
                        path="/settings/embed-config"
                        element={<ManagerRoute Component={GeneralSecurity} />}
                      />
                      <Route
                        path="/settings/embed-chats"
                        element={<ManagerRoute Component={GeneralSecurity} />}
                      />
                      <Route
                        path="/settings/security"
                        element={<AdminRoute Component={GeneralSecurity} />}
                      />
                      <Route
                        path="/settings/privacy"
                        element={<AdminRoute Component={PrivacyAndData} />}
                      />
                      <Route
                        path="/settings/appearance"
                        element={<ManagerRoute Component={InterfaceSettings} />}
                      />
                      <Route
                        path="/settings/api-keys"
                        element={<AdminRoute Component={GeneralApiKeys} />}
                      />
                      <Route
                        path="/settings/custom-app-name"
                        element={<AdminRoute Component={BrandingSettings} />}
                      />
                      <Route
                        path="/settings/custom-logo"
                        element={<AdminRoute Component={BrandingSettings} />}
                      />
                      <Route
                        path="/settings/custom-messages"
                        element={<AdminRoute Component={BrandingSettings} />}
                      />
                      <Route
                        path="/settings/chat"
                        element={<AdminRoute Component={ChatSettings} />}
                      />
                      <Route
                        path="/settings/browser-extension"
                        element={
                          <AdminRoute Component={GeneralBrowserExtension} />
                        }
                      />
                      <Route
                        path="/settings/sovereign-engine"
                        element={
                          <AdminRoute Component={SovereignEngineSettings} />
                        }
                      />
                      <Route
                        path="/settings/workspaces"
                        element={<ManagerRoute Component={AdminWorkspaces} />}
                      />
                      {/* Onboarding Flow */}
                      <Route path="/onboarding" element={<OnboardingFlow />} />
                      <Route
                        path="/onboarding/:step"
                        element={<OnboardingFlow />}
                      />
                    </Routes>
                  </ErrorBoundary>
                  <ToastContainer />
                  <KeyboardShortcutsHelp />
                </I18nextProvider>
              </PfpProvider>
            </LogoProvider>
          </AuthProvider>
        </Suspense>
      </PWAModeProvider>
    </ThemeProvider>
  );
}
