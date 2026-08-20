// @vitest-environment jsdom
/**
 * Which way the save menu opens, over the report of 20 August: inside the
 * improved-transcript dialog it opened downwards and the dialog — which
 * scrolls, and therefore clips — cut it in half.
 *
 * jsdom does no layout, so the geometry is supplied: what is being pinned is
 * the decision, and the decision was reading the wrong box.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "../i18n";
import { DocumentSaveMenu } from "./documents";
import { enCommon } from "../locales/en/common";

/** A window 1000 tall, and inside it a dialog that scrolls. */
function stage({ dialogBottom, buttonTop }: { dialogBottom: number; buttonTop: number }) {
  window.innerHeight = 1000;

  const view = render(
    <I18nProvider>
      <div data-testid="dialog" style={{ overflowY: "auto" }}>
        <DocumentSaveMenu disabled={false} onChoose={() => {}} />
      </div>
    </I18nProvider>
  );

  const dialog = screen.getByTestId("dialog");
  dialog.getBoundingClientRect = () =>
    ({ top: 100, bottom: dialogBottom }) as DOMRect;

  // The menu's own container is the button's parent.
  const button = screen.getByText(enCommon["common.save"]!).closest("button")!;
  const container = button.parentElement!;
  container.getBoundingClientRect = () =>
    ({ top: buttonTop, bottom: buttonTop + 34 }) as DOMRect;

  return { view, button };
}

beforeEach(() => {
  // jsdom reports "" for overflowY unless it is asked to compute it.
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    (element: Element) =>
      ({
        overflowY: (element as HTMLElement).style.overflowY || "visible",
      }) as CSSStyleDeclaration
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

const opensAbove = () =>
  !!document.querySelector(".document-save-menu")?.classList.contains("opens-above");

describe("the save menu", () => {
  /** The reported fault. The window has 460 px below the button, so measuring
   *  the window said *plenty of room* — while the dialog had 26 px. */
  test("opens upwards when the dialog would cut it off, though the window would not", () => {
    const { button } = stage({ dialogBottom: 540, buttonTop: 480 });

    fireEvent.click(button);

    expect(opensAbove()).toBe(true);
  });

  /** And still opens downwards where the dialog really does have the room —
   *  the flip is for the case that needs it, not the normal one. */
  test("opens downwards when the dialog has room", () => {
    const { button } = stage({ dialogBottom: 900, buttonTop: 300 });

    fireEvent.click(button);

    expect(opensAbove()).toBe(false);
  });

  /** Both formats are on offer either way — the menu that was being cut in
   *  half is the one that has to arrive whole. */
  test("offers both formats", () => {
    const { button } = stage({ dialogBottom: 540, buttonTop: 480 });

    fireEvent.click(button);

    expect(screen.getByText("TXT")).toBeTruthy();
    expect(screen.getByText("MD")).toBeTruthy();
    expect(document.querySelectorAll(".document-save-menu button").length).toBe(2);
  });
});
