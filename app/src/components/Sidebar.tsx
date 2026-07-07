type View = "farm" | "vault" | "docs";

export function Sidebar({ view, onNavigate }: { view: View; onNavigate: (v: "farm") => void }) {
  return (
    <div className="sidebar">
      <div className="sidebar-brand">
        <img className="brand-mark" src="/monkey-call.jpg" alt="Monkey Finance" />
        <div className="brand-name">
          <span>Monkey</span>
          <span>Finance</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        <button className={`nav-item ${view === "farm" ? "active" : ""}`} onClick={() => onNavigate("farm")}>
          <span className="nav-icon">🌾</span> Farm Volatility
        </button>
        <a
          className="nav-item"
          href="https://monkey-finance.gitbook.io/monkey-finance-docs/"
          target="_blank"
          rel="noreferrer"
        >
          <span className="nav-icon">📄</span> Documentation
        </a>
      </nav>

      <div className="sidebar-extras">
        <div className="sidebar-divider">
          <span>🌿</span>
          <span>🍌</span>
          <span>🌿</span>
        </div>

        <div className="sidebar-social">
          <a href="https://t.me/monkeyfinancesolana" target="_blank" rel="noreferrer" className="social-icon" title="Telegram">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M21.5 3.5 2.7 10.8c-.9.35-.9 1.62.02 1.94l4.56 1.58 1.76 5.66c.24.77 1.2.99 1.76.4l2.44-2.58 4.62 3.4c.7.52 1.7.15 1.9-.7l3.2-15.2c.24-1.13-.87-2.05-1.9-1.8zM8.9 14.6l-1.1-3.7 9.9-6.2-8.8 9.9z" />
            </svg>
          </a>
          <a href="https://x.com/MonkeyFiSolana" target="_blank" rel="noreferrer" className="social-icon" title="X (Twitter)">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M18.9 2H22l-7.5 8.6L23 22h-6.9l-5.4-6.6L4.5 22H1.4l8-9.2L1 2h7.1l4.9 6.1L18.9 2zm-1.2 18h1.9L7.4 4h-2l12.3 16z" />
            </svg>
          </a>
          <a
            href="https://github.com/Monkeyfinance-solana/Monkey-Finance-1.0.0"
            target="_blank"
            rel="noreferrer"
            className="social-icon"
            title="GitHub"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M12 .5C5.73.5.75 5.48.75 11.75c0 5.02 3.26 9.28 7.78 10.78.57.1.78-.25.78-.55 0-.27-.01-1.16-.02-2.11-3.17.69-3.84-1.35-3.84-1.35-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.75 1.18 1.75 1.18 1.02 1.75 2.68 1.24 3.33.95.1-.74.4-1.24.72-1.53-2.53-.29-5.19-1.27-5.19-5.63 0-1.24.44-2.26 1.17-3.06-.12-.29-.51-1.45.11-3.02 0 0 .96-.31 3.13 1.17a10.9 10.9 0 0 1 5.7 0c2.17-1.48 3.13-1.17 3.13-1.17.62 1.57.23 2.73.11 3.02.73.8 1.17 1.82 1.17 3.06 0 4.37-2.66 5.34-5.2 5.62.41.36.77 1.06.77 2.14 0 1.55-.01 2.79-.01 3.17 0 .3.2.66.79.55A11.26 11.26 0 0 0 23.25 11.75C23.25 5.48 18.27.5 12 .5z" />
            </svg>
          </a>
        </div>
      </div>
    </div>
  );
}
