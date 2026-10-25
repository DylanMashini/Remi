/**
 * Public pages: no session, no sidebar. The page owns its own header and footer so the landing
 * can set its hero flush under a slim top bar.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh flex-col">{children}</div>;
}
