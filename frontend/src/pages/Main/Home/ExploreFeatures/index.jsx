import { useNavigate } from "react-router-dom";
import paths from "@/utils/paths";
import Workspace from "@/models/workspace";
import { useTranslation } from "react-i18next";
import { useManageWorkspaceModal } from "@/components/Modals/ManageWorkspace";
import ManageWorkspace from "@/components/Modals/ManageWorkspace";
import { useState } from "react";
import showToast from "@/utils/toast";
import {
  GlobeHemisphereWest,
  ChartBar,
  FileText,
} from "@phosphor-icons/react";

export default function ExploreFeatures() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showModal } = useManageWorkspaceModal();
  const [selectedWorkspace, setSelectedWorkspace] = useState(null);

  const openGtdMap = async () => {
    const workspaces = await Workspace.all();
    if (workspaces.length > 0) {
      navigate(paths.workspace.gtdMap(workspaces[0].slug));
    }
  };

  const openChat = async () => {
    const workspaces = await Workspace.all();
    if (workspaces.length > 0) {
      navigate(paths.workspace.chat(workspaces[0].slug));
    }
  };

  const manageDocuments = async () => {
    const workspaces = await Workspace.all();
    if (workspaces.length > 0) {
      setSelectedWorkspace(workspaces[0]);
      showModal();
    }
  };

  return (
    <div>
      <h1 className="text-theme-home-text uppercase text-sm font-semibold mb-4">
        {t("main-page.exploreMore.title")}
      </h1>
      <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <FeatureCard
          icon={GlobeHemisphereWest}
          title={t("main-page.exploreMore.features.gtdHeatmap.title")}
          description={t("main-page.exploreMore.features.gtdHeatmap.description")}
          primaryAction={t("main-page.exploreMore.features.gtdHeatmap.primaryAction")}
          onPrimaryAction={openGtdMap}
          badge="Interactive Map"
        />
        <FeatureCard
          icon={ChartBar}
          title={t("main-page.exploreMore.features.analyticsCharts.title")}
          description={t("main-page.exploreMore.features.analyticsCharts.description")}
          primaryAction={t("main-page.exploreMore.features.analyticsCharts.primaryAction")}
          onPrimaryAction={openChat}
          badge="Recharts"
        />
        <FeatureCard
          icon={FileText}
          title={t("main-page.exploreMore.features.documentRag.title")}
          description={t("main-page.exploreMore.features.documentRag.description")}
          primaryAction={t("main-page.exploreMore.features.documentRag.primaryAction")}
          onPrimaryAction={manageDocuments}
          badge="LanceDB"
        />
      </div>

      {selectedWorkspace && (
        <ManageWorkspace
          providedSlug={selectedWorkspace.slug}
          hideModal={() => {
            setSelectedWorkspace(null);
          }}
        />
      )}
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
  primaryAction,
  onPrimaryAction,
  badge,
}) {
  return (
    <div className="border border-white/[0.08] bg-white/[0.02] rounded-2xl p-5 flex flex-col justify-between gap-y-4 transition-all duration-200 hover:border-white/20 hover:bg-white/[0.04]">
      <div className="flex flex-col gap-y-3">
        <div className="flex items-center justify-between">
          <div className="w-9 h-9 rounded-xl bg-white/[0.06] border border-white/[0.1] flex items-center justify-center text-white">
            <Icon size={20} weight="duotone" />
          </div>
          {badge && (
            <span className="px-2.5 py-0.5 text-[11px] font-medium tracking-wide text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
              {badge}
            </span>
          )}
        </div>
        <h2 className="text-theme-home-text font-semibold text-base">
          {title}
        </h2>
        <p className="text-theme-home-text-secondary text-sm leading-relaxed">
          {description}
        </p>
      </div>
      <div className="pt-2">
        <button
          onClick={onPrimaryAction}
          className="w-full h-[40px] border border-white/20 text-white rounded-xl text-sm font-medium flex items-center justify-center transition-all duration-200 hover:bg-white hover:text-black hover:border-white active:scale-[0.98]"
        >
          {primaryAction}
        </button>
      </div>
    </div>
  );
}
