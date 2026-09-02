/**
 * Saving something out of a whole recording.
 *
 * The same shape as the clip's saving and for the same reason: one file asks
 * the reader to name it, several ask once for a folder. What is worth holding
 * here is the audio's name — it keeps the recording's own container, so the
 * file plays wherever the recording does and is handed over rather than
 * re-encoded.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveRecording } from "./saveRecording";
import type { Recording } from "./types";

const exportAudio = vi.fn(async (_id: string, _path: string) => {});
const saveExport = vi.fn(async (_id: string, _format: string, path: string) => path);

vi.mock("./api", () => ({
  api: {
    exportAudio: (...a: Parameters<typeof exportAudio>) => exportAudio(...a),
    saveExport: (...a: Parameters<typeof saveExport>) => saveExport(...a),
  },
}));

const PAUL = {
  id: "r",
  title: "Paul Bartlett",
  path: "D:\nahravky\paul.m4a",
  segment_count: 964,
} as unknown as Recording;

/** A path in the chosen folder. The separator is built from its code point:
 *  a literal backslash in a test is one tool away from being read as an
 *  escape, and this one was, three times over. */
const SEPARATOR = String.fromCharCode(92);
const inVen = (name: string) => `D:/ven${SEPARATOR}${name}`;

const common = {
  recording: PAUL,
  chooseFile: vi.fn(async () => null),
  chooseFolder: vi.fn(async () => null),
  onError: vi.fn(),
  onSaved: vi.fn(),
};

describe("saving a recording", () => {
  beforeEach(() => {
    exportAudio.mockClear();
    saveExport.mockClear();
  });

  it("asks for a file name when one thing is ticked", async () => {
    const chooseFile = vi.fn(async (name: string) => `D:/ven/${name}`);
    const onSaved = vi.fn();
    await saveRecording({ ...common, shapes: ["srt"], chooseFile, onSaved });

    expect(chooseFile).toHaveBeenCalledWith("Paul Bartlett.srt");
    expect(saveExport).toHaveBeenCalledWith("r", "srt", "D:/ven/Paul Bartlett.srt");
    expect(onSaved).toHaveBeenCalledWith(["D:/ven/Paul Bartlett.srt"]);
  });

  /** The audio keeps the source's container. An .m4a recording saved as .mp3
   *  would have to be re-encoded, and nobody asked for that. */
  it("offers the audio under the recording's own extension", async () => {
    const chooseFile = vi.fn(async (name: string) => `D:/ven/${name}`);
    await saveRecording({ ...common, shapes: ["audio"], chooseFile, onSaved: vi.fn() });
    expect(chooseFile).toHaveBeenCalledWith("Paul Bartlett.m4a");
    expect(exportAudio).toHaveBeenCalledWith("r", "D:/ven/Paul Bartlett.m4a");
  });

  it("asks for a folder once when several are ticked", async () => {
    const chooseFolder = vi.fn(async () => "D:/ven");
    const onSaved = vi.fn();
    await saveRecording({
      ...common,
      shapes: ["audio", "txt"],
      chooseFolder,
      onSaved,
    });

    expect(chooseFolder).toHaveBeenCalledTimes(1);
    expect(exportAudio).toHaveBeenCalledWith("r", inVen("Paul Bartlett.m4a"));
    expect(saveExport).toHaveBeenCalledWith("r", "txt", inVen("Paul Bartlett.txt"));
    expect(onSaved).toHaveBeenCalledWith([
      inVen("Paul Bartlett.m4a"),
      inVen("Paul Bartlett.txt"),
    ]);
  });

  /** A title is a person's name, not a file name. */
  it("takes the characters a file name cannot hold out of the title", async () => {
    const chooseFile = vi.fn(async (name: string) => name);
    await saveRecording({
      ...common,
      recording: { ...PAUL, title: "Q1: plán/rozpočet" } as Recording,
      shapes: ["txt"],
      chooseFile,
      onSaved: vi.fn(),
    });
    expect(chooseFile).toHaveBeenCalledWith("Q1- plán-rozpočet.txt");
  });

  it("writes nothing when the reader closes the dialog", async () => {
    const onSaved = vi.fn();
    await saveRecording({ ...common, shapes: ["txt"], onSaved });
    expect(saveExport).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
