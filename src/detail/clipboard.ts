/** Putting text on the clipboard from inside a WebView.
 *
 *  Its own file because both halves are one idea and they had drifted apart:
 *  the error lived beside the note helpers and the function that raises it
 *  beside the context menu, so neither read as belonging to anything.
 */

/** Raised when even the selection-based fallback is refused. The wording shown
 *  to the person belongs to the caller: this function lives outside a component
 *  and cannot reach the dictionary. */
export class ClipboardRefused extends Error {}

/** Clipboard API first, with a WebView-safe fallback for restricted contexts. */
export async function copyPlainText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Some WebView builds expose the API but deny it outside a secure origin.
    // The user initiated this action, so the selection-based fallback is safe.
  }

  const field = document.createElement("textarea");
  field.value = text;
  field.readOnly = true;
  field.style.position = "fixed";
  field.style.inset = "0 auto auto -9999px";
  document.body.appendChild(field);
  field.focus();
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new ClipboardRefused("clipboard refused the copy");
}
