import {
  SquaresFour,
  ChatDots,
  Files,
  GlobeHemisphereWest,
} from "@phosphor-icons/react";
import paths from "@/utils/paths";
import { t } from "i18next";

const noop = () => {};

export const CHECKLIST_UPDATED_EVENT = "VertexAI_checklist_updated";
export const CHECKLIST_STORAGE_KEY = "VertexAI_checklist_completed";
export const CHECKLIST_HIDDEN = "VertexAI_checklist_dismissed";

/**
 * @typedef {Object} ChecklistItemHandlerParams
 * @property {Object[]} workspaces - Array of workspaces
 * @property {Function} navigate - Function to navigate to a path
 * @property {Function} setSelectedWorkspace - Function to set the selected workspace
 * @property {Function} showManageWsModal - Function to show the manage workspace modal
 * @property {Function} showToast - Function to show a toast
 * @property {Function} showNewWsModal - Function to show the new workspace modal
 */

/**
 * @typedef {Object} ChecklistItem
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {string} action
 * @property {function(ChecklistItemHandlerParams): (boolean|Promise<boolean>)} handler
 * @property {import("@phosphor-icons/react").Icon} icon
 */

/**
 * Checklist items to be completed by the user
 * @returns {ChecklistItem[]}
 */
export const CHECKLIST_ITEMS = () => [
  {
    id: "create_workspace",
    title: t("main-page.checklist.tasks.create_workspace.title"),
    description: t("main-page.checklist.tasks.create_workspace.description"),
    action: t("main-page.checklist.tasks.create_workspace.action"),
    handler: ({ showNewWsModal = noop }) => {
      showNewWsModal();
      return true;
    },
    icon: SquaresFour,
  },
  {
    id: "query_gtd",
    title: t("main-page.checklist.tasks.query_gtd.title"),
    description: t("main-page.checklist.tasks.query_gtd.description"),
    action: t("main-page.checklist.tasks.query_gtd.action"),
    handler: ({
      workspaces = [],
      navigate = noop,
      showToast = noop,
      showNewWsModal = noop,
    }) => {
      if (workspaces.length === 0) {
        showToast(t("main-page.noWorkspaceError"), "warning", {
          clear: true,
        });
        showNewWsModal();
        return false;
      }
      navigate(paths.workspace.chat(workspaces[0].slug));
      return true;
    },
    icon: ChatDots,
  },
  {
    id: "explore_gtd_map",
    title: t("main-page.checklist.tasks.explore_gtd_map.title"),
    description: t("main-page.checklist.tasks.explore_gtd_map.description"),
    action: t("main-page.checklist.tasks.explore_gtd_map.action"),
    handler: ({
      workspaces = [],
      navigate = noop,
      showToast = noop,
      showNewWsModal = noop,
    }) => {
      if (workspaces.length === 0) {
        showToast(t("main-page.noWorkspaceError"), "warning", { clear: true });
        showNewWsModal();
        return false;
      }
      navigate(paths.workspace.gtdMap(workspaces[0].slug));
      return true;
    },
    icon: GlobeHemisphereWest,
  },
  {
    id: "embed_document",
    title: t("main-page.checklist.tasks.embed_document.title"),
    description: t("main-page.checklist.tasks.embed_document.description"),
    action: t("main-page.checklist.tasks.embed_document.action"),
    handler: ({
      workspaces = [],
      setSelectedWorkspace = noop,
      showManageWsModal = noop,
      showToast = noop,
      showNewWsModal = noop,
    }) => {
      if (workspaces.length === 0) {
        showToast(t("main-page.noWorkspaceError"), "warning", {
          clear: true,
        });
        showNewWsModal();
        return false;
      }
      setSelectedWorkspace(workspaces[0]);
      showManageWsModal();
      return false;
    },
    icon: Files,
  },
];
