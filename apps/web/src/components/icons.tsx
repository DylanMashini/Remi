import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Base({ size = 20, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const HomeIcon = (p: IconProps) => (
  <Base {...p}><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></Base>
);
export const PeopleIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" />
    <circle cx="17" cy="9" r="2.5" />
    <path d="M17 14c2.4 0 4 1.6 4.5 4" />
  </Base>
);
export const CalendarIcon = (p: IconProps) => (
  <Base {...p}><rect x="3" y="5" width="18" height="15" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></Base>
);
export const LiveIcon = (p: IconProps) => (
  <Base {...p}><circle cx="6.5" cy="13" r="3.5" /><circle cx="17.5" cy="13" r="3.5" /><path d="M10 13h4M3 13V9M21 13V9" /></Base>
);
export const CheckIcon = (p: IconProps) => (
  <Base strokeWidth={2.4} {...p}><path d="M5 12l5 5L20 7" /></Base>
);
export const PersonIcon = (p: IconProps) => (
  <Base {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></Base>
);
export const ChatIcon = (p: IconProps) => (
  <Base {...p}><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></Base>
);
export const QuestionIcon = (p: IconProps) => (
  <Base {...p}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01" /></Base>
);
export const AnswerIcon = (p: IconProps) => (
  <Base {...p}><path d="M4 5h16v11H9l-5 4z" /><path d="M8 10h8M8 13h5" /></Base>
);
export const BellIcon = (p: IconProps) => (
  <Base {...p}><path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z" /><path d="M10 21h4" /></Base>
);
export const SpeakerIcon = (p: IconProps) => (
  <Base {...p}><path d="M4 9h4l5-4v14l-5-4H4z" /><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></Base>
);
export const TrashIcon = (p: IconProps) => (
  <Base {...p}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></Base>
);
export const PlayIcon = (p: IconProps) => (
  <Base {...p}><path d="M7 5l12 7-12 7z" /></Base>
);
export const ArrowLeftIcon = (p: IconProps) => (
  <Base {...p}><path d="M19 12H5M11 6l-6 6 6 6" /></Base>
);
export const ShieldIcon = (p: IconProps) => (
  <Base {...p}><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" /></Base>
);
export const MemoryIcon = (p: IconProps) => (
  <Base {...p}><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="12" cy="10.5" r="2.5" /><path d="M7.5 17c.8-2 2.4-3 4.5-3s3.7 1 4.5 3" /></Base>
);
export const MicIcon = (p: IconProps) => (
  <Base {...p}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></Base>
);
export const PencilIcon = (p: IconProps) => (
  <Base {...p}><path d="M4 20l4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10z" /><path d="M13.5 7.5l3 3" /></Base>
);
export const ChevronRightIcon = (p: IconProps) => (
  <Base strokeWidth={2.4} {...p}><path d="M9 6l6 6-6 6" /></Base>
);
