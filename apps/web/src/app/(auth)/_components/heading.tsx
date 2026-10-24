export function AuthHeading({ title, lead }: { title: string; lead?: string }) {
  return (
    <header className="mb-6">
      <h1 className="font-[family-name:var(--font-nunito)] text-[28px] font-extrabold leading-tight text-[#1E2B2F]">{title}</h1>
      {lead ? <p className="mt-2 text-[17px] leading-relaxed text-[#4F5D61]">{lead}</p> : null}
    </header>
  );
}
