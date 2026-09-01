/**
 * The find bar over the transcript.
 *
 * Draws what `useTranscriptSearch` holds and calls back into it. It owns
 * nothing: the same search is driven from the toolbar button beside the panel
 * toggle and from Ctrl+F, and a bar that kept its own copy of the query would
 * be a second answer to the same question.
 *
 * The markup and the class names are the ones this bar has always had.
 */
import { useI18n } from "../i18n";
import type { TranscriptSearch as Search } from "./useTranscriptSearch";

export function TranscriptSearch({ search }: { search: Search }) {
  const { t } = useI18n();
  const { state, actions } = search;

  if (!state.open) return null;

  return (
    <div className="search-transcript">
      <input
        ref={state.field}
        value={state.query}
        autoFocus
        spellCheck={false}
        placeholder={t("detail.find.placeholder")}
        aria-label={t("detail.find.placeholder")}
        onChange={(event) => actions.write(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (event.shiftKey) actions.previous();
            else actions.next();
          }
        }}
      />
      <span className="search-count">
        {!state.searching
          ? ""
          : t("detail.find.count", {
              at: String(state.at),
              total: String(state.total),
            })}
      </span>
      <button
        disabled={state.total === 0}
        onClick={actions.previous}
        aria-label={t("detail.find.previous")}
        title={t("detail.find.previous")}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
          <path d="M3.5 8.5 7 5l3.5 3.5" fill="none" stroke="currentColor"
                strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        disabled={state.total === 0}
        onClick={actions.next}
        aria-label={t("detail.find.next")}
        title={t("detail.find.next")}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
          <path d="M3.5 5.5 7 9l3.5-3.5" fill="none" stroke="currentColor"
                strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button onClick={actions.close} aria-label={t("common.close")} title={t("common.close")}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
          <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor"
                strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
