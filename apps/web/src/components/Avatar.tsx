import { initials } from "./format";

/** Person portrait via the authed file route, with an initials fallback. Apricot means "a person". */
export function Avatar({
  name,
  avatarFileId,
  size = 44,
  ring = true,
  className = "",
}: {
  name: string;
  avatarFileId?: string | null;
  size?: number;
  ring?: boolean;
  className?: string;
}) {
  const border = ring ? Math.max(2, Math.round(size / 24)) : 0;
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38), borderWidth: border };
  if (avatarFileId) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- authed route, not optimizable
      <img
        src={`/api/files/${avatarFileId}`}
        alt=""
        style={style}
        className={`shrink-0 rounded-pill border-solid border-apricot bg-apricot-mist object-cover ${className}`}
      />
    );
  }
  return (
    <div
      style={style}
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-pill border-solid border-apricot bg-apricot font-display font-extrabold text-ink ${className}`}
    >
      {initials(name)}
    </div>
  );
}

/** Pulls the file id out of an `/api/files/<id>` url (what the API hands back). */
export function fileIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const id = url.split("/").pop();
  return id || null;
}
