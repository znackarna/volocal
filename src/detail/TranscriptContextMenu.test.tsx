// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MENU_ICONS, TranscriptContextMenu } from "./TranscriptContextMenu";

/** The menu the right button opens over the transcript. Everything here is a
 *  rule that was written because of something that went wrong once: a menu
 *  half outside the window, a menu left pointing at a paragraph that had
 *  scrolled away, a menu that stayed open behind the action it started. */

afterEach(cleanup);

const items = [
  { label: "Přehrát odsud", icon: MENU_ICONS.play, action: vi.fn() },
  { label: "Kopírovat", icon: MENU_ICONS.copy, action: vi.fn() },
  { label: "Smazat", icon: MENU_ICONS.edit, action: vi.fn(), warning: true },
];

/** jsdom gives every element a zero-sized box, so a menu with real corners has
 *  to be described to it. 1024×768 is jsdom's window. */
function withSize(width: number, height: number) {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0 } as DOMRect;
  };
  return () => {
    Element.prototype.getBoundingClientRect = original;
  };
}

function open(over: Partial<Parameters<typeof TranscriptContextMenu>[0]> = {}) {
  const onClose = vi.fn();
  render(<TranscriptContextMenu x={100} y={100} items={items} onClose={onClose} {...over} />);
  return { onClose, surface: document.querySelector(".kontextova-nabidka") as HTMLElement };
}

describe("TranscriptContextMenu", () => {
  test("every offered action is a menu item, in the order given", () => {
    open();
    expect(screen.getAllByRole("menuitem").map((b) => b.textContent)).toEqual([
      "Přehrát odsud",
      "Kopírovat",
      "Smazat",
    ]);
  });

  test("the first item has the keyboard, so the menu can be used without the mouse", () => {
    open();
    expect(document.activeElement?.textContent).toBe("Přehrát odsud");
  });

  test("an action that undoes work is marked as one", () => {
    open();
    expect(screen.getByText("Smazat").closest("button")?.className).toBe("varovne");
    expect(screen.getByText("Kopírovat").closest("button")?.className).toBe("");
  });

  test("the menu opens where the pointer is", () => {
    const restore = withSize(200, 150);
    const { surface } = open({ x: 300, y: 400 });
    expect(surface.style.left).toBe("300px");
    expect(surface.style.top).toBe("400px");
    restore();
  });

  test("opened near the bottom right corner it stays wholly on screen", () => {
    // Without this the menu was drawn half outside the window and the last
    // action could not be reached at all.
    const restore = withSize(200, 150);
    const { surface } = open({ x: 1000, y: 750 });
    expect(surface.style.left).toBe(`${1024 - 200 - 8}px`);
    expect(surface.style.top).toBe(`${768 - 150 - 8}px`);
    restore();
  });

  test("it never sits flush against the top left edge either", () => {
    const restore = withSize(200, 150);
    const { surface } = open({ x: -50, y: 0 });
    expect(surface.style.left).toBe("8px");
    expect(surface.style.top).toBe("8px");
    restore();
  });

  test("choosing an action closes the menu first, then acts", () => {
    const order: string[] = [];
    const action = vi.fn(() => order.push("action"));
    const onClose = vi.fn(() => order.push("close"));
    render(
      <TranscriptContextMenu
        x={10}
        y={10}
        items={[{ label: "Kopírovat", icon: MENU_ICONS.copy, action }]}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByRole("menuitem"));
    // Closing first: an action that opens a dialog must not leave the menu
    // hanging over it.
    expect(order).toEqual(["close", "action"]);
  });

  test("Escape closes it", () => {
    const { onClose } = open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("a press anywhere else closes it", () => {
    const { onClose } = open();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("a press inside it does not", () => {
    const { onClose, surface } = open();
    fireEvent.mouseDown(surface);
    expect(onClose).not.toHaveBeenCalled();
  });

  test("scrolling the transcript closes it, because it was pointing at something", () => {
    const { onClose } = open();
    // Capture phase: the transcript scrolls, not the window, and the event
    // never bubbles up from it.
    fireEvent.scroll(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("resizing the window closes it rather than leaving it misplaced", () => {
    const { onClose } = open();
    fireEvent(window, new Event("resize"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /** An item with children opens them in place of the menu. It is how the
   *  transcript offers the speakers by name, and the rules are the ones a
   *  drill-down needs: going in acts on nothing, and there is a way back. */
  describe("an item that opens more items", () => {
    const assign = (action = vi.fn()) => ({
      label: "Přiřadit mluvčího",
      icon: MENU_ICONS.speaker,
      children: [
        { label: "Roman Povala", icon: MENU_ICONS.speaker, color: "#1f6feb", action },
        { label: "Janka Bílá", icon: MENU_ICONS.speaker, action: vi.fn() },
      ],
    });

    test("opening it replaces the menu rather than closing it", () => {
      const onClose = vi.fn();
      render(
        <TranscriptContextMenu x={10} y={10} items={[assign()]} onClose={onClose} />
      );
      fireEvent.click(screen.getByText("Přiřadit mluvčího"));

      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getAllByRole("menuitem").map((b) => b.textContent)).toEqual([
        "Roman Povala",
        "Janka Bílá",
      ]);
    });

    test("and there is a way back to what was there before", () => {
      render(<TranscriptContextMenu x={10} y={10} items={[assign()]} onClose={vi.fn()} />);
      fireEvent.click(screen.getByText("Přiřadit mluvčího"));
      // The back button carries the name of what was opened, so it says where
      // it goes rather than only that it goes.
      fireEvent.click(screen.getByText("Přiřadit mluvčího"));

      expect(screen.getAllByRole("menuitem").map((b) => b.textContent)).toEqual([
        "Přiřadit mluvčího",
      ]);
    });

    test("choosing one of them closes the menu and acts", () => {
      const order: string[] = [];
      const action = vi.fn(() => order.push("action"));
      const onClose = vi.fn(() => order.push("close"));
      render(
        <TranscriptContextMenu x={10} y={10} items={[assign(action)]} onClose={onClose} />
      );
      fireEvent.click(screen.getByText("Přiřadit mluvčího"));
      fireEvent.click(screen.getByText("Roman Povala"));

      expect(order).toEqual(["close", "action"]);
    });

    test("a speaker's colour reaches the mark beside the name", () => {
      render(<TranscriptContextMenu x={10} y={10} items={[assign()]} onClose={vi.fn()} />);
      fireEvent.click(screen.getByText("Přiřadit mluvčího"));

      const mark = screen.getByText("Roman Povala").closest("button")?.querySelector("svg");
      expect(mark).toHaveProperty("style.color", "rgb(31, 111, 235)");
    });

    /** The list of names is taller than the item it replaced, so a menu opened
     *  near the bottom has to be measured again or it hangs off the edge. */
    test("it is measured again after opening, not only when it appeared", () => {
      const restore = withSize(200, 150);
      const { surface } = open({ x: 1000, y: 750, items: [assign()] });
      expect(surface.style.top).toBe(`${768 - 150 - 8}px`);

      restore();
      const taller = withSize(200, 400);
      fireEvent.click(screen.getByText("Přiřadit mluvčího"));
      expect(surface.style.top).toBe(`${768 - 400 - 8}px`);
      taller();
    });
  });

  test("once closed it listens for nothing", () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <TranscriptContextMenu x={10} y={10} items={items} onClose={onClose} />
    );
    unmount();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(document.body);
    fireEvent(window, new Event("resize"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
