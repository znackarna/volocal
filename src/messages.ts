/** Turning what Rust sends into a sentence the reader understands.
 *
 *  Rust does not know which language the window is running in, so it never
 *  sends a finished sentence. It sends a `UserMessage`: a stable code, the
 *  values that belong in it, and a technical `detail` for anything the
 *  dictionary does not cover yet. That way a failure nobody has written a
 *  sentence for is still shown as something rather than as nothing.
 */
import { useCallback } from "react";
import { useI18n, type Values } from "./i18n";
import type { UserMessage } from "./types";

/** Recognises the shape Rust sends. Anything else is printed as it is. */
function asUserMessage(value: unknown): UserMessage | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<UserMessage>;
  return typeof candidate.code === "string"
    ? { code: candidate.code, params: candidate.params ?? {}, detail: candidate.detail ?? "" }
    : null;
}

/** Archives written before this existed hold a finished Czech sentence in the
 *  error column; newer ones hold a stored `UserMessage`. Both arrive here as a
 *  string, and only one of them is worth parsing. */
function parseStored(value: string): UserMessage | null {
  if (!value.startsWith("{")) return null;
  try {
    return asUserMessage(JSON.parse(value));
  } catch {
    return null;
  }
}

/** `detail` is offered to the dictionary as `{detail}`, so an entry that wraps
 *  a technical text — "Writing failed: …" — needs no parameter of its own. */
function values(message: UserMessage): Values {
  return { ...message.params, detail: message.detail };
}

function useResolver(namespaces: readonly string[]) {
  const { tDynamic } = useI18n();
  return useCallback(
    (value: unknown): string => {
      const message =
        asUserMessage(value) ?? (typeof value === "string" ? parseStored(value) : null);
      if (!message) return String(value);
      // Namespaces are listed least specific first, so the last one holding
      // the code wins. With none of them holding it the technical detail is
      // shown, and failing even that, the bare code.
      return namespaces.reduce(
        (fallback, namespace) => tDynamic(`${namespace}.${message.code}`, fallback, values(message)),
        message.detail || message.code
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tDynamic]
  );
}

/** Wraps a sentence the window wrote itself so it can stand where Rust would
 *  normally have put one. It has no code, so it is printed as it is. */
export function localMessage(text: string): UserMessage {
  return { code: "", params: {}, detail: text };
}

/** Reads a failure thrown by an `api.*` call, or stored with a recording. */
export function useUserMessage() {
  return useResolver(["errors"]);
}

/** Reads a phase caption. Terminal phases carry a failure instead of a step,
 *  so the failure dictionary is consulted as well. */
export function useProgressMessage() {
  return useResolver(["errors", "progress"]);
}
