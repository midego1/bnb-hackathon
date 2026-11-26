/** KeyScrow mark: a house with a keyhole (same glyph as app/icon.svg). */
export function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={className}>
      <rect width="64" height="64" rx="14" fill="#f59e0b" />
      <path d="M32 12 10 30h6v21h32V30h6L32 12Z" fill="#0f172a" />
      <circle cx="32" cy="35" r="6" fill="#f59e0b" />
      <path d="M29.5 38h5l1.5 9h-8l1.5-9Z" fill="#f59e0b" />
    </svg>
  );
}
