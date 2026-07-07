import { VAULTS } from "../config";
import { VaultCard } from "./VaultCard";
import { useVaultData, fmtRaw, fmtCompact } from "../hooks/useVaultData";
import { CLUSTER } from "../network";

export function FarmList({ onOpenVault }: { onOpenVault: (key: string) => void }) {
  // The protocol-wide dashboard sums stats across every *live* vault. Right
  // now there's only one, so this mirrors it directly -- once more vaults go
  // live in config.ts, extend this to fetch+sum each of them.
  const liveVaults = VAULTS.filter((v) => v.status === "live" && v.tknMint);
  const primary = useVaultData(liveVaults[0]?.tknMint ?? null);

  const totalFees = primary.cfg
    ? primary.cfg.totalBurned.add(primary.cfg.totalRewardDistributed)
    : null;

  return (
    <div>
      <div className="beta-banner">
        ⚠️{" "}
        <span>
          <b>Beta</b> -- {CLUSTER === "mainnet" ? "this is an unaudited mainnet test deployment" : "this is a local test deployment"}.
          Contracts are unaudited; don't put in more than you can afford to lose.
        </span>
      </div>

      <div className="hero">
        <img className="hero-img hero-img-left" src="/monkey-mainpage.jpg" alt="" aria-hidden="true" />
        <div className="hero-center">
          <div className="hero-title">Monkey Finance</div>
          <div className="hero-tagline">🍌 Keep winning when the market goes bananas 🍌</div>
        </div>
        <img className="hero-img hero-img-right" src="/monkey-calculating.png" alt="" aria-hidden="true" />
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Protocol overview</h2>
        </div>
        <div className="stat-grid">
          <div className="stat">
            <span className="icon">💰</span>
            <div className="label">TVL</div>
            <div className="value">{primary.cfg ? `${fmtCompact(primary.tvl, primary.decimals)} TKN` : "-"}</div>
          </div>
          <div className="stat">
            <span className="icon">🧾</span>
            <div className="label">Total accumulated fees</div>
            <div className="value">{totalFees ? `${fmtRaw(totalFees, primary.decimals)} TKN` : "-"}</div>
          </div>
          <div className="stat">
            <span className="icon">📈</span>
            <div className="label">Total yield paid</div>
            <div className="value accent">
              {primary.cfg ? `${fmtRaw(primary.cfg.totalRewardDistributed, primary.decimals)} TKN` : "-"}
            </div>
          </div>
          <div className="stat">
            <span className="icon">🔥</span>
            <div className="label">Total burned</div>
            <div className="value">{primary.cfg ? `${fmtRaw(primary.cfg.totalBurned, primary.decimals)} TKN` : "-"}</div>
          </div>
        </div>
      </div>

      <div className="section-title">Vaults</div>
      <div className="vault-grid">
        {VAULTS.map((v) => (
          <VaultCard key={v.key} vault={v} onOpen={() => onOpenVault(v.key)} />
        ))}
      </div>
    </div>
  );
}
