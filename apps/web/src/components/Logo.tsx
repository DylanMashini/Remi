export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" fill="none" aria-hidden="true">
      <circle cx="22" cy="22" r="21" fill="#2C6E68" />
      <path d="M14 23.5c0-4.4 3.6-8 8-8s8 3.6 8 8" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="22" cy="27.5" r="3.2" fill="#F2B48C" />
    </svg>
  );
}

export function Wordmark({ size = 36, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`flex items-center gap-3 ${className}`}>
      <LogoMark size={size} />
      <span className="font-display font-extrabold text-[22px] tracking-tight text-ink">Recall</span>
    </span>
  );
}
