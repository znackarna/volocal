import { useEffect, useState } from "react";

import { useI18n } from "./i18n";
import { useDialog } from "./useDialog";

/**
 * Giving something a name — a new folder, an existing folder, a transcript.
 *
 * One dialog for all three, because the question is always the same: what is
 * this called. The caller supplies the words, so the dialog never has to guess
 * from its arguments what it is being used for — a recording's title may
 * legitimately be empty, which is exactly what the folder version used to read
 * as "this is a new one".
 */
export default function NameDialog({
  open,
  title,
  text,
  label,
  placeholder,
  submitLabel,
  initialName,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** The heading, and with it what this dialog is for. */
  title: string;
  text: string;
  label: string;
  placeholder: string;
  submitLabel: string;
  initialName: string;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(initialName);
  const dialog = useDialog<HTMLDivElement>(onClose, open);

  // The field starts on whatever the dialog was opened with, each time.
  useEffect(() => {
    if (open) setName(initialName);
  }, [open, initialName]);

  if (!open) return null;

  const trimmed = name.trim();

  const submit = () => {
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  return (
    <div className="prekryv-dialogu" onMouseDown={onClose}>
      <div
        ref={dialog}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="name-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="name-dialog-title">{title}</h2>
        <p>{text}</p>

        <div className="pole folder-dialog-field">
          <label htmlFor="name-dialog-field">{label}</label>
          <input
            id="name-dialog-field"
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={placeholder}
          />
        </div>

        <div className="dialog-patka">
          <button className="tlacitko" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="tlacitko hlavni" onClick={submit} disabled={!trimmed}>
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
