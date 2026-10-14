/**
 * WASP brand mark.
 *
 * A rounded hexagon — the cell of a paper-wasp nest — carrying three angled
 * abdomen stripes. Drawn on the accent gradient so it stays within the app palette.
 * Scales cleanly from favicon (16px) to hero (96px).
 */
export default function WaspMark({
  size = 40,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="wasp-body" x1="8" y1="4" x2="40" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4f8df9" />
          <stop offset="1" stopColor="#1d4ed8" />
        </linearGradient>
      </defs>

      {/* Hexagonal nest cell, rounded */}
      <path
        d="M20.5 3.02a7 7 0 0 1 7 0l11.62 6.71a7 7 0 0 1 3.5 6.06v13.42a7 7 0 0 1-3.5 6.06L27.5 41.98a7 7 0 0 1-7 0L8.88 35.27a7 7 0 0 1-3.5-6.06V15.79a7 7 0 0 1 3.5-6.06L20.5 3.02Z"
        fill="url(#wasp-body)"
      />

      {/* Wasp stripes — three angled bands */}
      <g stroke="#ffffff" strokeWidth="3.4" strokeLinecap="round">
        <path d="M15.5 17.5h17" transform="rotate(-8 24 17.5)" />
        <path d="M14 24.5h20" transform="rotate(-8 24 24.5)" />
        <path d="M17.5 31.5h13" transform="rotate(-8 24 31.5)" />
      </g>
    </svg>
  );
}
