// Small flat-style monkey illustrations used in place of generic finance
// emoji on the Protocol overview stats. Each one is the same base monkey
// face with a prop relevant to what the stat means, so it reads as "this
// number is monkey/banana flavored" rather than a generic 💰/🔥 icon.
// Pure inline SVG -- no external image/gif hosting to depend on (nothing to
// 404, nothing NSFW-roulette from a random Giphy embed). A subtle hover
// wiggle (see .stat:hover .icon svg in index.css) gives them a bit of the
// "gif" liveliness without an actual animated file.

function Face() {
  return (
    <>
      <circle cx="8" cy="14" r="7" fill="#8a5a2b" />
      <circle cx="32" cy="14" r="7" fill="#8a5a2b" />
      <circle cx="20" cy="20" r="15" fill="#a9702f" />
      <ellipse cx="20" cy="23.5" rx="10" ry="8" fill="#f2d9a8" />
      <circle cx="15" cy="19" r="1.8" fill="#2b1c10" />
      <circle cx="25" cy="19" r="1.8" fill="#2b1c10" />
      <path d="M14 26 Q20 31 26 26" stroke="#2b1c10" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </>
  );
}

// TVL -- a whole stash of bananas next to the face.
export function MonkeyBunchIcon() {
  return (
    <svg viewBox="0 0 40 40" width="26" height="26">
      <Face />
      <path d="M27 33 Q34 30 32 22 Q26 26 27 33 Z" fill="#ffcb3d" stroke="#c98f12" strokeWidth="0.6" />
      <path d="M31 32 Q38 28 35 20 Q29 25 31 32 Z" fill="#ffd75e" stroke="#c98f12" strokeWidth="0.6" />
    </svg>
  );
}

// Fees -- a peeled banana ("the peel" taken off, matching the wrap-fee joke).
export function MonkeyPeelIcon() {
  return (
    <svg viewBox="0 0 40 40" width="26" height="26">
      <Face />
      <path d="M22 32 Q30 30 30 20 Q24 22 22 32 Z" fill="#ffcb3d" stroke="#c98f12" strokeWidth="0.6" />
      <path d="M22 32 Q16 34 15 27 Q19 27 22 32 Z" fill="#e8c15a" stroke="#c98f12" strokeWidth="0.6" />
    </svg>
  );
}

// Yield paid -- a single banana held up, with a little shine/sparkle.
export function MonkeyYieldIcon() {
  return (
    <svg viewBox="0 0 40 40" width="26" height="26">
      <Face />
      <path d="M26 12 Q34 10 31 2 Q24 4 26 12 Z" fill="#ffcb3d" stroke="#c98f12" strokeWidth="0.6" />
      <path d="M4 6 L5.6 8.4 L8 10 L5.6 11.6 L4 14 L2.4 11.6 L0 10 L2.4 8.4 Z" fill="var(--accent)" />
      <path d="M34 18 L35 19.4 L36.4 20 L35 20.6 L34 22 L33 20.6 L31.6 20 L33 19.4 Z" fill="var(--accent)" />
    </svg>
  );
}

// Total burned -- flame right next to the face.
export function MonkeyFireIcon() {
  return (
    <svg viewBox="0 0 40 40" width="26" height="26">
      <Face />
      <path
        d="M30 34c-4 0-7-2.5-7-6.5 0-3 2-5 2.6-7.4.4 1.6 2 2.6 2 4.4 1.6-1.6 1.8-4.2 1.2-6 3 1.6 5.2 5 5.2 9 0 4-3 6.5-4 6.5Z"
        fill="#ff7a3d"
      />
      <path d="M30 34c-2.2 0-3.8-1.4-3.8-3.6 0-1.8 1.4-3 2-4.4 1 1.6 2.4 2.6 2.4 4.6 0-1 .6-1.8 1-2.6.8 1.4 1.4 3 1.4 4 0 1.6-1.2 2-3 2Z" fill="#ffcb3d" />
    </svg>
  );
}
