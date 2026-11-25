/** The marketing page's icons: one 24-unit grid, 2-unit round strokes (the play triangle is the one solid). */
const base = { viewBox: "0 0 24 24", width: 18, height: 18, "aria-hidden": true } as const;
const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const PlayIcon = () => (
  <svg {...base}>
    <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" fill="currentColor" />
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
