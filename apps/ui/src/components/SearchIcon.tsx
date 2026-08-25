export function SearchIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      className="search-icon" viewBox="0 0 24 24"
      width={size} height={size} fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}
