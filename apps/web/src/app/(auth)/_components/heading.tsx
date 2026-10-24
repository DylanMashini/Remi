export function AuthHeading({ title, lead }: { title: string; lead?: string }) {
  return (
    <header className="mb-6 flex flex-col gap-2">
      <h1 className="m-0 font-display text-[28px] font-extrabold leading-tight tracking-[-0.5px]">{title}</h1>
      {lead ? <p className="m-0 text-[17px] leading-relaxed text-ink-soft">{lead}</p> : null}
    </header>
  );
}
