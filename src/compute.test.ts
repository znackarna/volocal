/**
 * The refusal on the `Výkon` card, over the report of 25 August: switching
 * between the two cards flashed `sestavení pro něj zatím není stažené` in red
 * and took it back a fraction of a second later.
 *
 * The bug was not in either value but in reading them together at a moment when
 * they answered different questions — the setting had moved, `check_tools` had
 * not been asked again. So what is pinned here is the pairing: a check answers
 * one stored setting, and the card says nothing until it holds the answer to
 * the one on screen.
 */
import { describe, expect, test } from "vitest";
import { computeFellBack, computeMode, computeRefused } from "./compute";
import type { ToolCheck } from "./types";

/** Only the four fields these rules read. */
function machine(over: Partial<ToolCheck> = {}): ToolCheck {
  return {
    compute: "cpu",
    available_compute_backends: ["cpu"],
    nvidia_driver: false,
    vulkan_driver: false,
    ...over,
  } as ToolCheck;
}

const onGraphicsCard = machine({ compute: "cuda", nvidia_driver: true });
const onProcessor = machine({ compute: "cpu", nvidia_driver: true });

describe("what the stored value means", () => {
  test("the two names from before 14 August are the graphics card", () => {
    expect(computeMode("cuda")).toBe("gpu");
    expect(computeMode("vulkan")).toBe("gpu");
  });

  test("anything unrecognised is automatic, which is what the backend does with it", () => {
    expect(computeMode("")).toBe("auto");
    expect(computeMode("vychozi")).toBe("auto");
  });
});

describe("the refusal", () => {
  /** The reported fault, as it happens: the press is stored, the check still
   *  answers the pick before it. Before the pairing this returned true. */
  test("is silent while the check still answers the previous pick", () => {
    expect(computeRefused("cpu", "gpu", onGraphicsCard)).toBe(false);
  });

  /** And the other direction, which flashed the same way. */
  test("is silent the other way round too", () => {
    expect(computeRefused("gpu", "cpu", onProcessor)).toBe(false);
  });

  /** What the card is for, once the answer belongs to the question. */
  test("speaks when the answer to this pick contradicts it", () => {
    expect(computeRefused("cpu", "cpu", onGraphicsCard)).toBe(true);
    expect(computeRefused("gpu", "gpu", onProcessor)).toBe(true);
  });

  test("is silent when the pick was honoured", () => {
    expect(computeRefused("cpu", "cpu", onProcessor)).toBe(false);
    expect(computeRefused("gpu", "gpu", onGraphicsCard)).toBe(false);
  });

  /** `auto` instructs nothing, so there is nothing to contradict. */
  test("cannot happen while the application is choosing", () => {
    expect(computeRefused("auto", "auto", onProcessor)).toBe(false);
    expect(computeRefused("auto", "auto", onGraphicsCard)).toBe(false);
  });

  /** An old settings record naming a build is the same question as `gpu`, so
   *  the first look at the screen is not a round trip behind itself. */
  test("reads a stored `cuda` and a stored `gpu` as one question", () => {
    expect(computeRefused("gpu", "cuda", onProcessor)).toBe(true);
  });

  test("says nothing before the first check has arrived", () => {
    expect(computeRefused("cpu", null, onGraphicsCard)).toBe(false);
    expect(computeRefused("cpu", "cpu", null)).toBe(false);
  });
});

describe("the graphics card sitting out a run", () => {
  test("is worth saying only where a driver could have run it", () => {
    expect(computeFellBack("auto", onProcessor)).toBe(true);
    expect(computeFellBack("auto", machine({ compute: "cpu" }))).toBe(false);
  });

  test("is not said to somebody who asked for the processor", () => {
    expect(computeFellBack("cpu", onProcessor)).toBe(false);
  });

  test("is not said while the card is running the transcript", () => {
    expect(computeFellBack("auto", onGraphicsCard)).toBe(false);
  });
});
