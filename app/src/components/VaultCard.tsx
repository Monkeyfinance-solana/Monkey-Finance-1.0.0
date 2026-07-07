import { useVaultData, fmtCompact } from "../hooks/useVaultData";
import type { VaultDef } from "../config";

export function VaultCard({ vault, onOpen }: { vault: VaultDef; onOpen: () => void }) {
  const isLive = vault.status === "live" && !!vault.tknMint;
  const data = useVaultData(isLive ? vault.tknMint : null);

  if (!isLive) {
    return (
      <div className="vault-card soon">
        <div className="vault-card-top">
          <span className="vault-icon">{vault.icon}</span>
          <div>
            <div className="vault-name">{vault.name}</div>
            <span className="pill soon-pill">
              <span className="dot" /> Coming soon
            </span>
          </div>
        </div>
        <div className="vault-card-stats">
          <div>
            <div className="label">TVL</div>
            <div className="value muted">-</div>
          </div>
          <div>
            <div className="label">LP APY</div>
            <div className="value muted">-</div>
          </div>
          <div>
            <div className="label">bTKN APY</div>
            <div className="value muted">-</div>
          </div>
        </div>
        <button className="secondary" disabled>
          Open position
        </button>
      </div>
    );
  }

  return (
    <div className="vault-card">
      <div className="vault-card-top">
        <span className="vault-icon">{vault.icon}</span>
        <div>
          <div className="vault-name">{vault.name}</div>
          {data.cfg ? (
            <span className={`pill ${data.cfg.paused ? "paused" : "active"}`}>
              <span className="dot" />
              {data.cfg.paused ? "Paused" : "Active"}
            </span>
          ) : (
            <span className="pill soon-pill">
              <span className="dot" /> loading...
            </span>
          )}
        </div>
      </div>
      <div className="vault-card-stats">
        <div>
          <div className="label">TVL</div>
          <div className="value">{data.cfg ? `${fmtCompact(data.tvl, data.decimals)} TKN` : "-"}</div>
        </div>
        <div>
          <div className="label">LP APY (est.)</div>
          <div className="value accent">{data.apy ?? "-"}</div>
        </div>
        <div>
          <div className="label">bTKN APY (est.)</div>
          <div className="value accent">{data.btknApy ?? "-"}</div>
        </div>
      </div>
      <button onClick={onOpen}>Open position</button>
    </div>
  );
}
