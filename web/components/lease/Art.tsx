import { COLORS, Padlock, Person, Safe } from "@/components/eli5/Drawings";

/** A small copy of the /how-it-works drawings for the renter page. */

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
