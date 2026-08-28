import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { api } from "./api";
import { useI18n } from "./i18n";

/** What the boundary caught, in a shape that can be read and sent on. The
 *  component stack is what says *where* it happened; a message alone rarely
 *  is enough to find the screen it came from. */
interface Crash {
  message: string;
  stack: string;
}

function describe(error: unknown, info?: ErrorInfo): Crash {
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === "string"
        ? error
        : JSON.stringify(error);
  // V8 opens `stack` with the message it was built from, so printing both
  // repeats the first line. The message is kept on its own for the case where
  // there is no stack at all — a string thrown by a library, say.
  const trace = (error instanceof Error && error.stack) || "";
  const stack = [trace.startsWith(message) ? trace.slice(message.length).trim() : trace, info?.componentStack]
    .filter(Boolean)
    .join("\n")
    .trim();
  return { message, stack };
}

/** The screen shown instead of the application. It is a separate function
 *  component because the boundary itself has to be a class, and the dictionary
 *  is only reachable through a hook. */
function CrashScreen({ crash }: { crash: Crash }) {
  const { t } = useI18n();
  const report = crash.stack ? `${crash.message}\n${crash.stack}` : crash.message;

  return (
    <div
      role="alert"
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 26px",
        background: "var(--ground)",
        color: "var(--text)",
        font: "14px/1.55 var(--font)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 560 }}>
        <h1 style={{ margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: "-0.01em" }}>
          {t("app.crash.title")}
        </h1>
        <p style={{ margin: "4px 0 0", color: "var(--text-quiet)" }}>{t("app.crash.text")}</p>

        <p style={{ margin: "18px 0 8px", fontSize: 13, color: "var(--text-quiet)" }}>
          {t("app.crash.detailLabel")}
        </p>
        {/* Selectable on purpose: this text is the whole point of the screen,
            and the person is being asked to send it somewhere. */}
        <pre
          style={{
            margin: 0,
            padding: "12px 14px",
            maxHeight: 220,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            userSelect: "text",
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: "var(--r-card)",
            font: "12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace",
            color: "var(--text-quiet)",
          }}
        >
          {report}
        </pre>

        <div style={{ marginTop: 22 }}>
          <button
            type="button"
            className="button primary"
            onClick={() => window.location.reload()}
          >
            {t("app.crash.reload")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The one class component in this project: catching a render error is the
 *  only thing React has no hook for. Without it a throw anywhere below unmounts
 *  the whole tree and leaves a white window with no way out and nothing to
 *  report. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { crash: Crash | null }> {
  state: { crash: Crash | null } = { crash: null };

  static getDerivedStateFromError(error: unknown) {
    return { crash: describe(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // The stack is only offered here, not to `getDerivedStateFromError`, so the
    // state written above is refined once it arrives.
    const crash = describe(error, info);
    this.setState({ crash });
    console.error(error);
    /* And into the log beside the archive, which is the file somebody is asked
       for. This text was assembled and only ever shown on screen, so a report
       of the window going white arrived with a log that said nothing about the
       moment it went white — half the application failing and none of it kept.

       Nothing is awaited and every failure is swallowed: the window is already
       broken, the backend may be the reason it is, and a boundary that throws
       while handling a throw takes the crash screen down with it. */
    void api.noteCrash(crash.message, crash.stack).catch(() => {});
  }

  render() {
    if (this.state.crash) return <CrashScreen crash={this.state.crash} />;
    return this.props.children;
  }
}
