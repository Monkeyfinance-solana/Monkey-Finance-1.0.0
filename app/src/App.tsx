import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { FarmList } from "./components/FarmList";
import { VaultDetail } from "./components/VaultDetail";
import { VAULTS } from "./config";

// "docs" is kept in the union only because Sidebar's shared View type still
// references it -- the nav item itself now links straight out to the
// GitBook site (see Sidebar.tsx) instead of routing here, so this view is
// never actually set by anything anymore.
type View = "farm" | "vault" | "docs";

export default function App({ connectButton }: { connectButton: React.ReactNode }) {
  const [view, setView] = useState<View>("farm");
  const [activeVaultKey, setActiveVaultKey] = useState<string | null>(null);

  const activeVault = VAULTS.find((v) => v.key === activeVaultKey) ?? null;

  function openVault(key: string) {
    setActiveVaultKey(key);
    setView("vault");
  }

  return (
    <div className="app-shell">
      <Sidebar view={view} onNavigate={(v) => setView(v)} />

      <div className="main-area">
        <div className="topbar">{connectButton}</div>
        <div className="content">
          {view === "farm" && <FarmList onOpenVault={openVault} />}
          {view === "vault" && activeVault && <VaultDetail vault={activeVault} onBack={() => setView("farm")} />}
        </div>
      </div>
    </div>
  );
}
