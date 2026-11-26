/** The marketing page's icons: one 24-unit grid, 2-unit round strokes (the play and pause glyphs are the solids). */
const base = { viewBox: "0 0 24 24", width: 18, height: 18, "aria-hidden": true } as const;
const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const PlayIcon = () => (
  <svg {...base}>
    <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" fill="currentColor" />
  </svg>
);

export const PauseIcon = () => (
  <svg {...base}>
    <path d="M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z" fill="currentColor" />
  </svg>
);

export const ArrowIcon = () => (
  <svg {...base} {...stroke}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const ExternalIcon = () => (
  <svg {...base} {...stroke} width={14} height={14}>
    <path d="M14 5h5v5M19 5l-8 8M11 7H6a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-5" />
  </svg>
);

export const CheckIcon = () => (
  <svg {...base} {...stroke}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

export const CrossIcon = () => (
  <svg {...base} {...stroke}>
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
  </svg>
);

/** The Mystery Box: the thing a judge rents on stage. */
export const BoxIcon = () => (
  <svg {...base} {...stroke}>
    <path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5v-7ZM4 8.5l8 4.5 8-4.5M12 13v7" />
  </svg>
);

export const PersonIcon = () => (
  <svg {...base} {...stroke} width={22} height={22}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20c.6-3.6 3.4-5.5 7-5.5s6.4 1.9 7 5.5" />
  </svg>
);

export const ShopIcon = () => (
  <svg {...base} {...stroke} width={22} height={22}>
    <path d="M4 10h16l-1.5-5h-13L4 10ZM5.5 10v9h13v-9M10 19v-5h4v5" />
  </svg>
);

export const PassportIcon = () => (
  <svg {...base} {...stroke} width={16} height={16}>
    <rect x="6" y="3.5" width="12" height="17" rx="1.5" />
    <circle cx="12" cy="10" r="2.5" />
    <path d="M9.5 16h5" />
  </svg>
);

export const SearchIcon = () => (
  <svg {...base} {...stroke}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </svg>
);

/** The escrow badge on a listing card: a shield with the keyhole of the logo. */
export const ShieldIcon = () => (
  <svg {...base} {...stroke} width={16} height={16}>
    <path d="M12 3.5 5 6v5.5c0 4.2 2.8 7.4 7 9 4.2-1.6 7-4.8 7-9V6l-7-2.5Z" />
    <circle cx="12" cy="10.5" r="1.6" />
    <path d="M12 12.1v3" />
  </svg>
);
