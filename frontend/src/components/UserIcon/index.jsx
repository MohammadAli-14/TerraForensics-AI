import React, { memo } from "react";
import usePfp from "../../hooks/usePfp";
import UserDefaultPfp from "./user.svg";
import TerraForensicsIcon from "@/media/logo/anything-llm-icon.png";
import WorkspaceDefaultPfp from "./workspace.svg";

const UserIcon = memo(({ role }) => {
  const { pfp } = usePfp();

  return (
    <div className="relative w-[35px] h-[35px] rounded-full flex-shrink-0 overflow-hidden">
      {role === "user" && <RenderUserPfp pfp={pfp} />}
      {role !== "user" && (
        <div className="w-full h-full rounded-full border border-slate-700/80 light:border-theme-sidebar-border bg-[#0B0F19] flex items-center justify-center p-[3px] shadow-sm">
          <img
            src={TerraForensicsIcon || WorkspaceDefaultPfp}
            alt="TerraForensics AI"
            className="w-full h-full object-contain"
          />
        </div>
      )}
    </div>
  );
});

function RenderUserPfp({ pfp }) {
  if (!pfp)
    return (
      <img
        src={UserDefaultPfp}
        alt="User profile picture"
        className="rounded-full border-none"
      />
    );

  return (
    <img
      src={pfp}
      alt="User profile picture"
      className="absolute top-0 left-0 w-full h-full object-cover rounded-full border-none"
    />
  );
}

export default UserIcon;
