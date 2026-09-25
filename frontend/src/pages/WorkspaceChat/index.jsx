import React, { useEffect, useState } from "react";
import { default as WorkspaceChatContainer } from "@/components/WorkspaceChat";
import Sidebar from "@/components/Sidebar";
import { useParams } from "react-router-dom";
import Workspace from "@/models/workspace";
import PasswordModal, { usePasswordModal } from "@/components/Modals/Password";
import { isMobile } from "react-device-detect";
import { FullScreenLoader } from "@/components/Preloader";
import { LAST_VISITED_WORKSPACE } from "@/utils/constants";
import WorkstationMapPanel from "@/components/WorkstationMapPanel";

import { Globe } from "@phosphor-icons/react";

export default function WorkspaceChat() {
  const { loading, requiresAuth, mode } = usePasswordModal();

  if (loading) return <FullScreenLoader />;
  if (requiresAuth !== false) {
    return <>{requiresAuth !== null && <PasswordModal mode={mode} />}</>;
  }

  return <ShowWorkspaceChat />;
}

function ShowWorkspaceChat() {
  const { slug } = useParams();
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  // Canvas is closed by default upon opening workspace; opened on-demand
  const [showMap, setShowMap] = useState(false);

  const handleToggleMap = (value) => {
    const nextVal = typeof value === "boolean" ? value : !showMap;
    setShowMap(nextVal);
    localStorage.setItem("tf_show_map", String(nextVal));
    if (nextVal) {
      const activeDataToDispatch = window.__tfLatestGtdData || (() => {
        try {
          const cached = localStorage.getItem(`tf:latest-gtd-data:${slug}`);
          return cached ? JSON.parse(cached) : null;
        } catch (e) {
          return null;
        }
      })();
      if (activeDataToDispatch) {
        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent("aegis:active-gtd-data", { detail: activeDataToDispatch })
          );
        }, 60);
      }
    }
  };

  // Allow chat components and buttons to request canvas open/close dynamically
  useEffect(() => {
    const handleOpenMap = () => {
      setShowMap(true);
      localStorage.setItem("tf_show_map", "true");
      const activeDataToDispatch = window.__tfLatestGtdData || (() => {
        try {
          const cached = localStorage.getItem(`tf:latest-gtd-data:${slug}`);
          return cached ? JSON.parse(cached) : null;
        } catch (e) {
          return null;
        }
      })();
      if (activeDataToDispatch) {
        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent("aegis:active-gtd-data", { detail: activeDataToDispatch })
          );
        }, 60);
      }
    };
    const handleCloseMap = () => {
      setShowMap(false);
      localStorage.setItem("tf_show_map", "false");
    };
    window.addEventListener("tf:open-map", handleOpenMap);
    window.addEventListener("tf:close-map", handleCloseMap);
    return () => {
      window.removeEventListener("tf:open-map", handleOpenMap);
      window.removeEventListener("tf:close-map", handleCloseMap);
    };
  }, []);

  useEffect(() => {
    async function getWorkspace() {
      if (!slug) return;
      const _workspace = await Workspace.bySlug(slug);
      if (!_workspace) return setLoading(false);

      const suggestedMessages = await Workspace.getSuggestedMessages(slug);
      const pfpUrl = await Workspace.fetchPfp(slug);
      setWorkspace({
        ..._workspace,
        suggestedMessages,
        pfpUrl,
      });
      setLoading(false);
      localStorage.setItem(
        LAST_VISITED_WORKSPACE,
        JSON.stringify({
          slug: _workspace.slug,
          name: _workspace.name,
        })
      );
    }
    getWorkspace();
  }, []);

  return (
    <div className="w-screen h-screen overflow-hidden bg-[#0B0F19] flex">
      {!isMobile && <Sidebar />}
      <div className="flex-1 flex h-full overflow-hidden relative">
        {/* Left Workstation Pane (Conversational Intelligence Console) */}
        <div
          className={`h-full flex flex-col relative transition-all duration-300 ${
            showMap ? "w-full lg:w-1/2 border-r border-slate-800" : "w-full"
          }`}
        >
          <WorkspaceChatContainer loading={loading} workspace={workspace} />

          {/* Floating button to reopen canvas when closed */}
          {!showMap && !isMobile && (
            <button
              onClick={() => handleToggleMap(true)}
              className="absolute top-4 right-6 z-30 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#0F172A]/90 hover:bg-[#1E293B] text-cyan-400 hover:text-cyan-300 border border-cyan-500/40 hover:border-cyan-400 shadow-xl backdrop-blur text-xs font-mono transition-all group"
              title="Open TerraForensics Geospatial Canvas"
            >
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
              <Globe size={16} className="text-cyan-400 group-hover:rotate-45 transition-transform" />
              <span className="font-semibold tracking-wide">Geospatial Canvas</span>
            </button>
          )}
        </div>

        {/* Right Workstation Pane (Synchronized Geospatial Map & Intelligence Canvas) */}
        {!isMobile && showMap && (
          <div className="hidden lg:flex lg:w-1/2 h-full flex-col bg-[#0F172A] relative transition-all duration-300">
            <WorkstationMapPanel
              workspace={workspace}
              onClose={() => handleToggleMap(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
