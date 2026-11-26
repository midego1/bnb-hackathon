/** KeyScrow mark: the app icon's neon key-shield, cropped tight so it stays crisp at 24-40 px (full icon: app/apple-icon.png). */
export function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  // fetchPriority low: React would otherwise preload it and compete with the landing hero (the LCP image).
  // eslint-disable-next-line @next/next/no-img-element -- 2 KB static mark, same file everywhere
  return <img src="/brand/mark-96.webp" alt="" aria-hidden width={96} height={96} fetchPriority="low" className={`${className} rounded-[22%] object-cover`} />;
}
