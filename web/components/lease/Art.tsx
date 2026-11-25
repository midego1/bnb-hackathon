import { COLORS, Jar, Padlock, Person, Safe } from "@/components/eli5/Drawings";

/** Small copies of the /how-it-works drawings for the rental and renter pages. */

/** The ELI5 safe with the owner's and the renter's lock, small. */
export function SafeArt({ fill, className = "h-14 w-16 shrink-0" }: { fill: number; className?: string }) {
  return (
    <svg viewBox="-135 -235 270 240" className={className} aria-hidden>
      <Safe fill={fill} />
      <g transform="translate(-55 -146)">
        <Padlock color={COLORS.landlord} dark={COLORS.landlordDark} open={0} />
      </g>
      <g transform="translate(55 -146)">
        <Padlock color={COLORS.tenant} dark={COLORS.tenantDark} open={0} />
      </g>
    </svg>
  );
}

/** The ELI5 KeyEscrow fee jar, small. */
export function JarArt() {
  return (
    <svg viewBox="-50 -110 100 115" className="h-12 w-11 shrink-0" aria-hidden>
      <Jar fill={0.5} />
    </svg>
  );
}

/** The renter next to the safe with its two locks: the renter page's hero picture. */
export function RenterArt({ className }: { className?: string }) {
  return (
    <svg viewBox="-20 -250 420 262" className={className} aria-hidden>
      <g transform="translate(80 0)">
        <Person who="tenant" />
      </g>
      <g transform="translate(270 0)">
        <Safe fill={0.6} />
        <g transform="translate(-55 -146)">
          <Padlock color={COLORS.landlord} dark={COLORS.landlordDark} open={0} />
        </g>
        <g transform="translate(55 -146)">
          <Padlock color={COLORS.tenant} dark={COLORS.tenantDark} open={0} />
        </g>
      </g>
    </svg>
  );
}
