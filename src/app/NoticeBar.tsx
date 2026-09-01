/**
 * The notice bar itself. Draws what `useNotices` holds and owns nothing.
 *
 * The ring empties over exactly the time the timer waits, so the number lives
 * with the timer and the stylesheet only draws it.
 */
import type { CSSProperties } from "react";
import { useI18n } from "../i18n";
import CountdownRing from "../CountdownRing";
import { NOTICE_LIFE } from "./useNotices";
import type { Notices } from "./useNotices";

export function NoticeBar({ notices }: { notices: Notices }) {
  const { t } = useI18n();
  const { notice, closing } = notices.state;

  if (!notice) return null;

  return (
    <div
      className={`notice ${notice.kind}${closing ? " leaving" : ""}`}
      role={notice.kind === "error" ? "alert" : "status"}
      style={{ "--notice-life": `${NOTICE_LIFE[notice.kind]}ms` } as CSSProperties}
    >
      {/* The ring empties over the seconds the bar has left, so it is visible
          that it will go on its own — and how soon. A bar that waits does not
          draw it: an emptying ring over a bar that is not leaving is a promise
          about the wrong thing. */}
      {!notice.action && <CountdownRing className="notice-countdown" size={16} />}
      <span>{notice.text}</span>
      {/* The way on before the way out, and the strong one of the two. Reading
          order is the order of the two answers: here is the thing, go to it, or
          not now. */}
      {notice.action && (
        <button
          className="notice-action"
          onClick={() => {
            notice.action?.run();
            notices.actions.dismiss();
          }}
        >
          {notice.action.label}
        </button>
      )}
      <button onClick={notices.actions.dismiss}>{t("common.close")}</button>
    </div>
  );
}
