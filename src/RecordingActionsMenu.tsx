import { useEffect, useRef, useState } from "react";

import { useI18n } from "./i18n";
import { useLabels } from "./labels";
import type { Folder } from "./types";
import { LINE_ICONS } from "./icons";

interface Props {
  status: string;
  onRename: () => void;
  /** Save the recording's own audio file somewhere the person can find it. */
  onExportAudio: () => void;
  /** The folders on offer, and where this recording sits — null is the root. */
  folders: Folder[];
  folder: string | null;
  /** `folder` of null takes it back out into the archive's root. */
  onMoveToFolder: (folder: string | null) => void;
  onCreateFolderFor: () => void;
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
  onExportAudio,
  folders,
  folder,
  onMoveToFolder,
  onCreateFolderFor,
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
          /* Transcribing again and transcribing again in another language are
             the same act with one extra decision, so they stand together
             (Jakub's call) rather than with a submenu's worth of list between
             them. */
          {
            label: t("dialogs.recordingMenu.transcribeInLanguage"),
            icon: Icons.language,
            children: labels.languageOptions().map((language) => ({
              label: language.label,
              action: () => onTranscribeInLanguage(language.value),
            })),
          },
          {
            label: t("dialogs.recordingMenu.deleteTranscript"),
            icon: Icons.deleteTranscript,
            action: onDeleteTranscript,
          },
        ]
      : []),
    {
      /* A submenu, like the language one above: the folders that exist and a
         way to make one on the spot. Both are the same question — which
         drawer — so both belong under one label. */
      label: t("dialogs.recordingMenu.moveToFolder"),
      icon: Icons.folder,
      children: [
        ...folders
          .filter((item) => item.id !== folder)
          .map((item) => ({
            label: item.name,
            icon: Icons.folder,
            action: () => onMoveToFolder(item.id),
          })),
        {
          label: t("dialogs.recordingMenu.newFolder"),
          icon: Icons.folderNew,
          action: onCreateFolderFor,
        },
      ],
    },
    /* Taking a recording out is not a choice of folder, so it does not live
       under one — and it is shown only for a recording that is in a folder,
       where it is the whole action rather than an item at the end of a list. */
    ...(folder
      ? [
          {
            label: t("dialogs.recordingMenu.outOfFolder"),
            icon: Icons.folderOut,
            action: () => onMoveToFolder(null),
          },
        ]
      : []),
    {
      label: t("dialogs.recordingMenu.exportAudio"),
      icon: Icons.exportAudio,
      action: onExportAudio,
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
  /* An eraser, not a document with a cross: what goes is the text, while the
     recording itself stays in the archive. The trash can belongs to the item
     below, which removes the recording. */
  deleteTranscript:
    "M7.5 17.5l7-7a2 2 0 0 1 2.9 0l2.1 2.1a2 2 0 0 1 0 2.9L16 19H9l-1.5-1.5Z M11.5 13.5l4.5 4.5 M4 20h16",
  language: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M3.6 9h16.8 M3.6 15h16.8 M12 3c2.3 2.4 3.5 5.6 3.5 9S14.3 18.6 12 21c-2.3-2.4-3.5-5.6-3.5-9S9.7 5.4 12 3Z",
  /* From the shared registry: the panel's speaker rows draw the same can. */
  remove: LINE_ICONS.remove,
  /* From the shared registry: three places draw a folder, and they must not
     drift apart. */
  folder: LINE_ICONS.folder,
  /* The same drawer with a plus in it, and with an arrow lifting out of it.
     A submenu of folder names needs its two actions to read as actions
     without leaving the folder's own shape behind.

     Both marks are centred on 13.25, not 14: the drawer's inside runs from the
     tab line at 7.5 to the bottom edge at 19, and the old 14 left 6.5 above and
     5 below — the plus visibly sat on the floor. The two are moved together
     because they appear one under the other in the same submenu, where a
     three-quarter difference in height reads as a mistake. */
  folderNew: `${LINE_ICONS.folder} M12 10.75v5 M9.5 13.25h5`,
  folderOut: `${LINE_ICONS.folder} M12 15.75v-5 M9.5 13.25l2.5-2.5 2.5 2.5`,
  /* A note over a tray: the audio itself, saved out of the archive. */
  exportAudio:
    "M8.5 17.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z M11 15V5l7 2v8 M18 15a2.5 2.5 0 1 1-5 0 M4 20h16",
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

export interface ActionItem {
  label: string;
  action?: () => void;
  warning?: boolean;
  icon?: string;
  children?: ActionItem[];
}

export function ActionMenu({
  items,
  className = "",
}: {
  items: ActionItem[];
  className?: string;
}) {
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

export { Icons as MENU_ICONS };
