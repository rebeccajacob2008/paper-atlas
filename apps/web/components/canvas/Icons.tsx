"use client";
// One icon set for the toolbar: same 1.6 stroke, same 18px box, same joins —
// mixed weights and styles were what made the old bar look unfinished.
type P = { className?: string };
const S = (p: { children: React.ReactNode } & P) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={p.className} aria-hidden>
    {p.children}
  </svg>
);

export const CursorIcon = (p: P) => <S {...p}><path d="M5 3l6.5 16 2.2-6.3L20 10.5 5 3z" /></S>;
export const HandIcon = (p: P) => <S {...p}><path d="M9 11V5.5a1.5 1.5 0 013 0V11m0-1V4.5a1.5 1.5 0 013 0V11m0-.5V6.5a1.5 1.5 0 013 0V14a6 6 0 01-6 6h-1a6 6 0 01-6-6v-3a1.5 1.5 0 013 0" /></S>;
export const PlusIcon = (p: P) => <S {...p}><path d="M12 5v14M5 12h14" /></S>;
export const ChevronDownIcon = (p: P) => <S {...p}><path d="M6 9l6 6 6-6" /></S>;
export const SearchIcon = (p: P) => <S {...p}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></S>;
export const FileIcon = (p: P) => <S {...p}><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" /><path d="M14 3v5h5" /></S>;
export const TextIcon = (p: P) => <S {...p}><path d="M5 6h14M9 6v13" /></S>;
export const StickyIcon = (p: P) => <S {...p}><path d="M5 5h14v9l-5 5H5z" /><path d="M19 14h-5v5" /></S>;
export const PaperIcon = (p: P) => <S {...p}><path d="M6 3h9l4 4v14H6z" /><path d="M9 11h7M9 15h7M9 7h3" /></S>;
export const ThreadIcon = (p: P) => <S {...p}><path d="M20 12a7 7 0 01-7 7H8l-4 3 1.2-4.2A7 7 0 1120 12z" /></S>;
export const WikiIcon = (p: P) => <S {...p}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.4 2.4 2.4 14.6 0 17M12 3.5c-2.4 2.4-2.4 14.6 0 17" /></S>;
export const EmbedIcon = (p: P) => <S {...p}><path d="M9 8l-5 4 5 4M15 8l5 4-5 4" /></S>;
export const GroupIcon = (p: P) => <S {...p}><rect x="3.5" y="3.5" width="10" height="10" rx="2" /><rect x="10.5" y="10.5" width="10" height="10" rx="2" /></S>;
export const LineIcon = (p: P) => <S {...p}><circle cx="5" cy="12" r="1.9" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.9" fill="currentColor" stroke="none" /><path d="M7 12h10" /></S>;
export const ArrowIcon = (p: P) => <S {...p}><circle cx="4.5" cy="16" r="1.8" fill="currentColor" stroke="none" /><path d="M6.5 15.4C10 14 12.5 11 14.5 7.5" /><path d="M18.5 6l-4.4 1.2L15 11" /></S>;
export const BiArrowIcon = (p: P) => <S {...p}><path d="M6.6 16.6C10 15 12.6 12 14.6 8.4" /><path d="M18.6 7l-4.3 1.2.9 3.7" /><path d="M6.2 12.1l-1 4.3 4.2 1" /></S>;
export const SparkIcon = (p: P) => <S {...p}><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /></S>;
export const HelpIcon = (p: P) => <S {...p}><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.4a2.5 2.5 0 114 2.2c-.9.6-1.6 1.1-1.6 2.1" /><path d="M12 17.2v.01" /></S>;
export const MicIcon = (p: P) => <S {...p}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21" /></S>;
