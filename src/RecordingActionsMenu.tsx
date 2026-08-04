import { useEffect, useRef, useState } from "react";

import { useI18n } from "./i18n";
import { useLabels } from "./labels";

interface Props {
  status: string;
  onRename: () => void;
  onRetranscribe: () => void;
  onDeleteTranscript: () => void;
  onTranscribeInLanguage: (language: string) => void;
  onRemove: () => void;
  className?: string;
}

/** One recording menu shared by Archive cards and transcript Detail. */
export default function RecordingActionsMenu({
  status,
  onRename,
  onRetranscribe,
  onDeleteTranscript,
  onTranscribeInLanguage,
  onRemove,
  className = "",
}: Props) {
  const { t } = useI18n();
  const labels = useLabels();
  const items: ActionItem[] = [
    { label: t("common.rename"), icon: Icons.rename, action: onRename },
    ...(status === "hotova"
      ? [
          {
            label: t("dialogs.recordingMenu.retranscribe"),
            icon: Icons.retranscribe,
            action: onRetranscribe,
          },
          {
            label: t("dialogs.recordingMenu.deleteTranscript"),
            icon: Icons.deleteTranscript,
            action: onDeleteTranscript,
          },
        ]
      : []),
    {
      label: t("dialogs.recordingMenu.transcribeInLanguage"),
      icon: Icons.language,
      children: labels.languageOptions().map((language) => ({
        label: language.label,
        action: () => onTranscribeInLanguage(language.value),
      })),
    },
    {
      label: t("dialogs.recordingMenu.remove"),
      icon: Icons.remove,
      action: onRemove,
      warning: true,
    },
  ];

  return <ActionMenu items={items} className={className} />;
}

/** Menu icons. Uniform 1.7 stroke on a 20 square, like the rest of the UI. */
const Icons = {
  rename: "M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z M13.5 6.5l4 4",
  retranscribe: "M20 11a8 8 0 1 0-2.3 5.7 M20 5v6h-6",
  deleteTranscript: "M6 4h8l4 4v12H6z M14 4v4h4 M9.5 12.5l5 5 M14.5 12.5l-5 5",
  language: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M3.6 9h16.8 M3.6 15h16.8 M12 3c2.3 2.4 3.5 5.6 3.5 9S14.3 18.6 12 21c-2.3-2.4-3.5-5.6-3.5-9S9.7 5.4 12 3Z",
  remove: "M4 7h16 M10 4h4 M6 7l1 13h10l1-13 M10 11v6 M14 11v6",
} as const;

function MenuIcon({ path }: { path: string }) {
  return (
    <svg className="nabidka-ikona" width="20" height="20" viewBox="0 0 24 24"
         fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
         strokeLinejoin="round" aria-hidden>
      {path.split(" M").map((segment, index) => (
        <path key={index} d={index === 0 ? segment : `M${segment}`} />
      ))}
    </svg>
  );
}

interface ActionItem {
  label: string;
  action?: () => void;
  warning?: boolean;
  icon?: string;
  children?: ActionItem[];
}

function ActionMenu({ items, className }: { items: ActionItem[]; className: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState<ActionItem | null>(null);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) setSubmenu(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className={`nabidka-akci ${className}`.trim()} ref={container}>
      <button className="ikona-tlacitko" onClick={() => setOpen((value) => !value)}
              aria-haspopup="menu" aria-expanded={open}
              aria-label={t("dialogs.recordingMenu.more")}>
        <svg width="16" height="4" viewBox="0 0 16 4" aria-hidden>
          <circle cx="2" cy="2" r="1.7" fill="currentColor" />
          <circle cx="8" cy="2" r="1.7" fill="currentColor" />
          <circle cx="14" cy="2" r="1.7" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div className="nabidka-akci-seznam" role="menu">
          {submenu && (
            <button className="nabidka-zpet" onClick={() => setSubmenu(null)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2"
                      strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {submenu.label}
            </button>
          )}
          {(submenu?.children ?? items).map((item) => (
            <button key={item.label} role="menuitem" className={item.warning ? "varovne" : ""}
                    onClick={() => {
                      if (item.children) {
                        setSubmenu(item);
                        return;
                      }
                      setOpen(false);
                      item.action?.();
                    }}>
              {item.icon && <MenuIcon path={item.icon} />}
              <span className="nabidka-popisek">{item.label}</span>
              {item.children && (
                <svg className="nabidka-sipka" width="14" height="14" viewBox="0 0 24 24"
                     fill="none" aria-hidden>
                  <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2"
                        strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
