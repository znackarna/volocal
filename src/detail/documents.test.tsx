// @vitest-environment jsdom
/**
 * The save menu in the improved-transcript dialog.
 *
 * On 20 August it opened downwards inside the dialog, and the dialog, which
 * scrolls and therefore clips, cut it in half. It then measured the nearest
 * scrolling box to decide which way to open. Since 2026-10-03 it is a popover:
 * it sits in the top layer, above the dialog, where nothing clips it, and the
 * CSS flips it upwards at the window's edge. jsdom does neither layout nor the
 * top layer, so what is pinned here is that it is a popover anchored to its
 * button, and that it arrives whole.
 */
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "../i18n";
import { DocumentSaveMenu } from "./documents";
import { enCommon } from "../locales/en/common";

function openMenu() {
  render(
    <I18nProvider>
      <DocumentSaveMenu disabled={false} onChoose={() => {}} />
    </I18nProvider>
  );
  fireEvent.click(screen.getByText(enCommon["common.save"]!).closest("button")!);
  return document.querySelector(".document-save-menu") as HTMLElement;
}

afterEach(() => cleanup());

describe("the save menu", () => {
  test("is a popover, so no scrolling dialog can cut it off", () => {
    expect(openMenu().getAttribute("popover")).toBe("auto");
  });

  test("offers both formats", () => {
    openMenu();
    expect(screen.getByText("TXT")).toBeTruthy();
    expect(screen.getByText("MD")).toBeTruthy();
    expect(document.querySelectorAll(".document-save-menu button").length).toBe(2);
  });

  test("closes when the browser closes it", () => {
    const menu = openMenu();
    fireEvent(menu, Object.assign(new Event("toggle"), { newState: "closed" }));
    expect(menu.querySelectorAll("button").length).toBe(0);
  });
});
