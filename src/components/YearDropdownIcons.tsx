export function ChevronIcon({ size = 14, open = false }: { size?: number; open?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .15s" }}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
