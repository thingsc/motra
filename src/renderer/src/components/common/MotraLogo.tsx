export function MotraLogo({ size = 28 }: { size?: number }): JSX.Element {
  return <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-label="Motra logo">
    <circle cx="27" cy="32" r="19" stroke="currentColor" strokeWidth="5" />
    <circle cx="27" cy="32" r="7" stroke="currentColor" strokeWidth="4" />
    <path d="M27 7v7M27 50v7M2 32h7M45 32h7M9.5 14.5l5 5M39.5 44.5l5 5M9.5 49.5l5-5M39.5 19.5l5-5" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    <path d="M48 23l10 9-10 9M45 43h14" stroke="#55c2d8" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}
