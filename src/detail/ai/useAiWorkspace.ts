/**
 * Everything the language model does to one recording, and everything the
 * reading window shows.
 *
 * The largest area of the transcript screen and the last one the split reached,
 * because almost all of it moves together: what has been made, what is being
 * made, which window is up, which tab is being read, and the two offers that
 * only exist because a run failed.
 *
 * **Why this is not a reducer.** The brief suggested one for the states that
 * transition together, and `dialog` already is that discriminant — `null`,
 * `missing`, `configure`, `preview`, one at a time, and every transition goes
 * through the actions below. What the rest of the state does is not transition
 * with it: the summary length and the translation language are the reader's
 * standing choices and survive every window, the documents arrive from the
 * backend on their own schedule, and folding them into one object would mean
 * writing four fields on every event that changes one. A reducer would be the
 * same machine with more ceremony.
 *
 * **What it is given rather than owns.** Telling the reader, walking to the
 * module list, fetching the recording again, and saving the plain transcript —
 * that last one because `Původní` is a tab of this window but an export of the
 * screen's own text, and this hook has no business knowing how a transcript is
 * written to disk.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { api } from "../../api";
import { useI18n } from "../../i18n";
import { ClipboardRefused, copyPlainText } from "../clipboard";
import { localMessage, useProgressMessage, useUserMessage } from "../../messages";
import {
  EDITOR_MODELS,
  EDITOR_TIER,
  UNOFFERED_COMPONENTS,
  qualityChoice,
} from "../../types";
import type {
  AiCustomDocument,
  AiDocument,
  AiEditProgress,
  AiOutput,
} from "../../types";
import type { PreviewTab, SummaryLength, TranslationLanguage } from "../documents";

/** Which run to repeat when an offer is taken or declined. The arguments and
 *  not a closure: the two functions that start a run cannot name themselves
 *  from inside their own bodies. */
type LastRun =
  | { kind: "edit"; mode: "faithful" | "clean" }
  | { kind: "output"; output: "summary" | "translation" | "custom"; variant: string }
  | null;

export interface AiWorkspace {
  state: {
    document: AiDocument | null;
    outputs: AiOutput[];
    customDocuments: AiCustomDocument[];
    running: boolean;
    progress: AiEditProgress | null;
    /** Language editing is set up in the settings, and its files are on disk. */
    configured: boolean;
    ready: boolean;
    dialog: "configure" | "preview" | "missing" | null;
    mode: "faithful" | "clean";
    previewTab: PreviewTab;
    previewScrolled: boolean;
    summaryLength: SummaryLength;
    translationLanguage: TranslationLanguage;
    /** The plain transcript, fetched once the reader asks for it. */
    originalPreview: string;
    /** What is written in the instruction field right now. */
    customPrompt: string;
    /** The instruction as it will be stored and looked up: without the spaces
     *  a field collects, so the same instruction typed twice is one. */
    writtenPrompt: string;
    /** What this recording already answered to exactly this instruction. */
    customDocument: AiCustomDocument | undefined;
    summaryOutput: AiOutput | undefined;
    translationOutput: AiOutput | undefined;
    /** The text of whichever tab is being read. */
    previewText: string;
    /** What language editing would cost on this machine. */
    editorOffer: { ids: string[]; megabytes: number; model: string } | null;
    editorDownloading: boolean;
    /** Which smaller model there is, after this computer failed to load the
     *  chosen one, and whether it is already here. */
    smallerOffer: { smaller: string; installed: boolean } | null;
  };
  actions: {
    receive: (status: {
      document: AiDocument | null;
      outputs: AiOutput[];
      custom: AiCustomDocument[];
      running: boolean;
      progress: AiEditProgress | null;
    }) => void;
    /** Whether the settings and the disk agree that a document can be made. */
    receiveReadiness: (configured: boolean, ready: boolean) => void;
    /** The `Vylepšit` button. */
    open: () => Promise<void>;
    closeDialog: () => void;
    chooseMode: (mode: "faithful" | "clean") => void;
    showTab: (tab: PreviewTab) => void;
    /** The transcript tab's second version, fetched on first use. */
    showOriginal: () => Promise<void>;
    noteScrolled: (scrolled: boolean) => void;
    chooseSummaryLength: (length: SummaryLength) => void;
    chooseTranslationLanguage: (language: TranslationLanguage) => void;
    writePrompt: (prompt: string) => void;
    startEdit: (mode: "faithful" | "clean") => Promise<void>;
    startOutput: (
      kind: "summary" | "translation" | "custom",
      variant: string
    ) => Promise<void>;
    startCustomDocument: () => void;
    cancel: () => void;
    /** The improved document is deleted; the tab goes back to offering one. */
    discard: () => Promise<void>;
    /** Back to the choice, starting from the way this document was made. */
    regenerate: () => void;
    copyPreview: () => Promise<void>;
    savePreview: (format: "txt" | "md") => Promise<void>;
    /** The improved transcript to disk, from the header's export menu — which
     *  offers it beside the plain one, so it is reached without the window. */
    saveImproved: (format: "txt" | "md") => Promise<void>;
    /** Accept the offer to fetch what language editing needs. */
    acceptEditorOffer: () => Promise<void>;
    dismissSmallerOffer: () => void;
    retrySameEditor: () => void;
    takeSmallerEditor: () => Promise<void>;
    /** Marks the document old, for a change made elsewhere on the screen. */
    markStale: () => void;
  };
}

export function useAiWorkspace({
  recordingId,
  onError,
  onInfo,
  onToModule,
  reload,
  saveTranscript,
}: {
  recordingId: string;
  onError: (message: string) => void;
  onInfo: (message: string) => void;
  onToModule: (module?: string) => void;
  reload: () => Promise<void>;
  /** Writes the plain transcript to disk. `Původní` is a tab of this window
   *  but an export of the screen's own text. */
  saveTranscript: (format: string) => Promise<void>;
}): AiWorkspace {
  const { t } = useI18n();
  const userMessage = useUserMessage();
  const progressMessage = useProgressMessage();

  const [document, setDocument] = useState<AiDocument | null>(null);
  const [outputs, setOutputs] = useState<AiOutput[]>([]);
  const [customDocuments, setCustomDocuments] = useState<AiCustomDocument[]>([]);
  const [customPrompt, setCustomPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<AiEditProgress | null>(null);
  const [configured, setConfigured] = useState(false);
  const [ready, setReady] = useState(false);
  const [dialog, setDialog] = useState<"configure" | "preview" | "missing" | null>(null);
  const [mode, setMode] = useState<"faithful" | "clean">("faithful");
  const [previewTab, setPreviewTab] = useState<PreviewTab>("improved");
  const [previewScrolled, setPreviewScrolled] = useState(false);
  const [summaryLength, setSummaryLength] = useState<SummaryLength>("standard");
  const [translationLanguage, setTranslationLanguage] = useState<TranslationLanguage>("en");
  const [originalPreview, setOriginalPreview] = useState("");
  const [editorOffer, setEditorOffer] = useState<
    { ids: string[]; megabytes: number; model: string } | null
  >(null);
  const [editorDownloading, setEditorDownloading] = useState(false);
  const [smallerOffer, setSmallerOffer] = useState<
    { smaller: string; installed: boolean } | null
  >(null);
  const lastRun = useRef<LastRun>(null);

  /* Each tab mounts its own article at the top, and the flag belongs to the
     document being read rather than to the window. Without this, opening a
     scrolled tab and switching leaves the fade over a document that starts at
     its first line. */
  useEffect(() => setPreviewScrolled(false), [previewTab]);

  const receive = useCallback(
    (status: {
      document: AiDocument | null;
      outputs: AiOutput[];
      custom: AiCustomDocument[];
      running: boolean;
      progress: AiEditProgress | null;
    }) => {
      setDocument(status.document);
      setOutputs(status.outputs);
      setCustomDocuments(status.custom);
      setRunning(status.running);
      if (status.running) {
        setProgress(
          status.progress ?? {
            recording_id: recordingId,
            phase: "preparing",
            percent: 2,
            description: localMessage(t("detail.progress.preparingModel")),
          }
        );
      }
    },
    [recordingId, t]
  );

  const receiveReadiness = useCallback((isConfigured: boolean, isReady: boolean) => {
    setConfigured(isConfigured);
    setReady(isReady);
  }, []);

  const markStale = useCallback(() => {
    setDocument((current) => (current ? { ...current, stale: true } : null));
  }, []);

  /** What language editing would cost on this machine, worked out the moment
   *  somebody first wants a document. Which model is not among the questions —
   *  the size follows the one answer given in the wizard. */
  const askForEditor = useCallback(async () => {
    try {
      const [components, settings, tools] = await Promise.all([
        api.catalog(),
        api.loadSettings(),
        api.checkTools(),
      ]);
      const chosen = Object.keys(EDITOR_MODELS).find(
        (id) => EDITOR_MODELS[id] === settings.editor_model
      );
      const tier = chosen ?? EDITOR_TIER[qualityChoice(settings)];
      const runtime = tools.vulkan_driver ? "editor-vulkan" : "editor-cpu";
      const ids = [tier, runtime].filter(
        (component) => !components.find((item) => item.id === component)?.complete
      );
      setEditorOffer({
        ids,
        megabytes: ids.reduce(
          (total, component) =>
            total + (components.find((item) => item.id === component)?.megabytes ?? 0),
          0
        ),
        model: EDITOR_MODELS[tier],
      });
      setDialog("missing");
    } catch (error) {
      onError(userMessage(error));
    }
  }, [onError, userMessage]);

  const open = useCallback(async () => {
    // A generated document remains useful even if the source transcript or
    // selected model changed later. Let the user inspect and save it first;
    // regeneration is a separate, explicit choice inside the preview.
    if (document) {
      setPreviewTab("improved");
      setDialog("preview");
      return;
    }
    /* **The offer is fixed.** What `Vylepšit` opens cannot depend on what
       happens to be stored beside the recording, because the button's whole
       promise is that the three improvements are available. With no improved
       transcript it goes to the choice, every time.

       This branch used to open the reading window whenever any document made
       from an instruction was saved: improve a transcript, delete the result,
       press `Vylepšit`, and the press landed in the preview, whose first three
       tabs are gated on the transcript that had just been deleted.

       The one case that is not about making anything: the model is gone from
       this machine and something was already made with it. Offering a
       multi-gigabyte download to somebody who wants to read their own saved
       text is the wrong answer, so that press opens the window it can. */
    if (!configured || !ready) {
      if (customDocuments.length > 0) {
        setPreviewTab("custom");
        setDialog("preview");
      } else if (editorDownloading) setDialog("missing");
      else await askForEditor();
      return;
    }
    setMode("faithful");
    setDialog("configure");
  }, [askForEditor, configured, customDocuments, document, editorDownloading, ready]);

  const startEdit = useCallback(
    async (chosenMode: "faithful" | "clean") => {
      lastRun.current = { kind: "edit", mode: chosenMode };
      setDialog(null);
      setPreviewTab("improved");
      setRunning(true);
      setProgress({
        recording_id: recordingId,
        phase: "preparing",
        percent: 2,
        description: localMessage(t("detail.progress.preparingModel")),
      });
      try {
        await api.startAiEdit(recordingId, chosenMode);
        const status = await api.aiEditStatus(recordingId);
        setRunning(status.running);
        if (status.progress) setProgress(status.progress);
      } catch (error) {
        setRunning(false);
        onError(userMessage(error));
      }
    },
    [onError, recordingId, t, userMessage]
  );

  const startOutput = useCallback(
    async (kind: "summary" | "translation" | "custom", variant: string) => {
      lastRun.current = { kind: "output", output: kind, variant };
      if (!configured || !ready) {
        if (editorDownloading) setDialog("missing");
        else await askForEditor();
        return;
      }
      setDialog(null);
      setRunning(true);
      setProgress({
        recording_id: recordingId,
        phase: "preparing",
        percent: 2,
        description: localMessage(
          kind === "summary"
            ? t("detail.progress.preparingSummary")
            : kind === "custom"
              ? t("detail.progress.preparingCustom")
              : t("detail.progress.preparingTranslation")
        ),
      });
      try {
        await api.startAiOutput(recordingId, kind, variant);
        const status = await api.aiEditStatus(recordingId);
        setRunning(status.running);
        setOutputs(status.outputs);
        setCustomDocuments(status.custom);
        if (status.progress) setProgress(status.progress);
      } catch (error) {
        setRunning(false);
        onError(userMessage(error));
      }
    },
    [askForEditor, configured, editorDownloading, onError, ready, recordingId, t, userMessage]
  );

  const writtenPrompt = customPrompt.trim();
  const customDocument = customDocuments.find((d) => d.prompt === writtenPrompt);

  /** An empty field never starts a run — the buttons that call this are
   *  disabled without one, and Rust refuses it a second time. Falling back to a
   *  prepared mode was the alternative and it is worse: a document nobody
   *  described is a document nobody can trust. */
  const startCustomDocument = useCallback(() => {
    const prompt = customPrompt.trim();
    if (!prompt) return;
    setPreviewTab("custom");
    void startOutput("custom", prompt);
  }, [customPrompt, startOutput]);

  const cancel = useCallback(() => {
    void api.cancelAiEdit(recordingId);
  }, [recordingId]);

  const regenerate = useCallback(() => {
    setMode((current) => (document?.mode === "clean" ? "clean" : document ? "faithful" : current));
    setDialog("configure");
  }, [document]);

  const discard = useCallback(async () => {
    await api.deleteAiDocument(recordingId);
    setDocument(null);
    setOutputs([]);
    setDialog(null);
  }, [recordingId]);

  const showOriginal = useCallback(async () => {
    setPreviewTab("original");
    if (originalPreview) return;
    try {
      setOriginalPreview(await api.exportPreview(recordingId, "txt"));
    } catch (error) {
      onError(userMessage(error));
    }
  }, [onError, originalPreview, recordingId, userMessage]);

  const summaryOutput = outputs.find(
    (output) => output.kind === "summary" && output.variant === summaryLength
  );
  const translationOutput = outputs.find(
    (output) => output.kind === "translation" && output.variant === translationLanguage
  );

  const previewText =
    previewTab === "improved"
      ? document?.text ?? ""
      : previewTab === "original"
        ? originalPreview
        : previewTab === "summary"
          ? summaryOutput?.text ?? ""
          : previewTab === "custom"
            ? customDocument?.text ?? ""
            : translationOutput?.text ?? "";

  const copyPreview = useCallback(async () => {
    if (!previewText.trim()) return;
    try {
      await copyPlainText(previewText);
      // One whole sentence per document, not a name glued in front of a verb:
      // the verb agrees with the noun.
      onInfo(
        t(
          previewTab === "improved"
            ? "detail.copied.improved"
            : previewTab === "original"
              ? "detail.copied.original"
              : previewTab === "summary"
                ? "detail.copied.summary"
                : previewTab === "custom"
                  ? "detail.copied.custom"
                  : "detail.copied.translation"
        )
      );
    } catch (error) {
      onError(
        error instanceof ClipboardRefused ? t("detail.preview.copyFailed") : userMessage(error)
      );
    }
  }, [onError, onInfo, previewTab, previewText, t, userMessage]);

  const saveImproved = useCallback(
    async (format: "txt" | "md") => {
      try {
        const name = await api.suggestedAiName(recordingId, format);
        const destination = await save({ defaultPath: name });
        if (!destination) return;
        await api.saveAiDocument(recordingId, format, destination);
        onInfo(t("detail.saved.improved", { path: destination }));
      } catch (error) {
        onError(userMessage(error));
      }
    },
    [onError, onInfo, recordingId, t, userMessage]
  );

  const saveOutput = useCallback(
    async (
      kind: "summary" | "translation" | "custom",
      variant: string,
      format: "txt" | "md"
    ) => {
      try {
        const name = await api.suggestedAiOutputName(recordingId, kind, variant, format);
        const destination = await save({ defaultPath: name });
        if (!destination) return;
        await api.saveAiOutput(recordingId, kind, variant, format, destination);
        // A whole sentence per kind. Czech declines the verb with the noun, so
        // there is nothing here to assemble from two halves.
        onInfo(
          t(
            kind === "summary"
              ? "detail.saved.summary"
              : kind === "custom"
                ? "detail.saved.custom"
                : "detail.saved.translation",
            { path: destination }
          )
        );
      } catch (error) {
        onError(userMessage(error));
      }
    },
    [onError, onInfo, recordingId, t, userMessage]
  );

  const savePreview = useCallback(
    async (format: "txt" | "md") => {
      if (previewTab === "improved") await saveImproved(format);
      else if (previewTab === "original") await saveTranscript(format);
      else if (previewTab === "summary") await saveOutput("summary", summaryLength, format);
      else if (previewTab === "custom") await saveOutput("custom", writtenPrompt, format);
      else await saveOutput("translation", translationLanguage, format);
    },
    [
      previewTab,
      saveImproved,
      saveOutput,
      saveTranscript,
      summaryLength,
      translationLanguage,
      writtenPrompt,
    ]
  );

  /** The setting is written now rather than when the files land. It says what
   *  was asked for; `resolve_editor_model` in `tools.rs` falls back to whatever
   *  model is actually on the disk, so a name written ahead of its file is not
   *  a dead end — and a listener that had to survive the reader walking to the
   *  Archive would not have survived it. */
  const acceptEditorOffer = useCallback(async () => {
    if (!editorOffer) return;
    setDialog(null);
    try {
      if (editorOffer.ids.length > 0) {
        await api.download(editorOffer.ids);
        setEditorDownloading(true);
      }
      const settings = await api.loadSettings();
      await api.saveSettings({ ...settings, editor_model: editorOffer.model });
      await reload();
      // Everything was already on the disk: there is nothing to wait for, so
      // the press that asked for a document goes on to ask what kind.
      if (editorOffer.ids.length === 0) {
        setMode("faithful");
        setDialog("configure");
      }
    } catch (error) {
      /* A download asked for while another is running joins the queue, so what
         is left is an ordinary failure, and an ordinary failure is said. */
      onError(userMessage(error));
    }
  }, [editorOffer, onError, reload, userMessage]);

  /** Decline the offer and run the same model again, changing nothing.
   *
   *  A failed load is a measurement of one moment, not of the computer. What is
   *  known is that it did not start; what is not known is whether something
   *  else held the memory while it tried. */
  const retrySameEditor = useCallback(() => {
    setSmallerOffer(null);
    const last = lastRun.current;
    if (last?.kind === "edit") void startEdit(last.mode);
    else if (last?.kind === "output") void startOutput(last.output, last.variant);
  }, [startEdit, startOutput]);

  /** Take the offer: write the smaller model into the settings and carry the
   *  run over. One press, and the thing that failed happens.
   *
   *  **The setting is written rather than used once, and the way back matters
   *  because of it.** A machine that could not load the model now will probably
   *  not load it in a minute, and repeating a load that ends in
   *  `ai.model_load_timeout` costs five minutes each time — which is what the
   *  writing avoids. But *probably* is the whole of it, so `Zkusit znovu`
   *  stands beside this button. */
  const takeSmallerEditor = useCallback(async () => {
    const offer = smallerOffer;
    if (!offer) return;
    setSmallerOffer(null);
    if (!offer.installed) {
      /* Not here yet, so the offer is a download and that screen owns it — the
         same route the missing-editor dialog takes, with the component already
         named. */
      onToModule(offer.smaller);
      return;
    }
    try {
      const settings = await api.loadSettings();
      await api.saveSettings({ ...settings, editor_model: EDITOR_MODELS[offer.smaller] });
      const last = lastRun.current;
      if (last?.kind === "edit") void startEdit(last.mode);
      else if (last?.kind === "output") void startOutput(last.output, last.variant);
    } catch (error) {
      onError(userMessage(error));
    }
  }, [onError, onToModule, smallerOffer, startEdit, startOutput, userMessage]);

  /* The run's own progress. This is the screen's only door for it, and the
     preview opens on `complete` and on nothing else. */
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    listen<AiEditProgress>("ai-edit:progress", (event) => {
      if (!active || event.payload.recording_id !== recordingId) return;
      setProgress(event.payload);
      const terminal = ["complete", "error", "cancelled"].includes(event.payload.phase);
      setRunning(!terminal);
      if (event.payload.phase === "complete") {
        api.aiEditStatus(recordingId).then((status) => {
          if (!active) return;
          setDocument(status.document);
          setOutputs(status.outputs);
          setCustomDocuments(status.custom);
          setDialog("preview");
        });
      } else if (event.payload.phase === "error") {
        /* These two are the machine saying it could not hold the model: the
           server died while loading, or never answered `/health` at all. They
           are already distinct from a missing binary and from a server that
           fell over mid-answer, so nothing new had to be measured to tell them
           apart — the names were there.

           Everything else is reported the ordinary way. A notice for a fault
           somebody can do nothing about is right; a dialog for it would be a
           second thing to dismiss. */
        const code = event.payload.description.code;
        if (code === "ai.model_load_timeout" || code === "ai.server_exited_while_loading") {
          void (async () => {
            try {
              const [components, settings] = await Promise.all([
                api.catalog(),
                api.loadSettings(),
              ]);
              const ladder = Object.keys(EDITOR_MODELS);
              const at = ladder.findIndex(
                (tier) => EDITOR_MODELS[tier] === settings.editor_model
              );
              /* Everything below the one that failed, and the first of those
                 that is offered at all — `editor-model-balanced` is in
                 `UNOFFERED_COMPONENTS` and must not be proposed by name here
                 when nothing else proposes it. */
              const smaller = ladder
                .slice(at + 1)
                .find((tier) => !UNOFFERED_COMPONENTS.includes(tier));
              if (at === -1 || !smaller) {
                onError(progressMessage(event.payload.description));
                return;
              }
              setSmallerOffer({
                smaller,
                installed: !!components.find((item) => item.id === smaller)?.complete,
              });
            } catch {
              /* The offer could not be worked out, so the fault is reported as
                 it would have been. Never nothing: a run that stopped must say
                 so however this goes. */
              onError(progressMessage(event.payload.description));
            }
          })();
        } else {
          onError(progressMessage(event.payload.description));
        }
      }
    }).then((stop) => {
      if (active) unlisten = stop;
      else stop();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [onError, progressMessage, recordingId]);

  /* The language editor landing while this screen is open. Nothing else on it
     depends on a download, so the listener exists only while one of ours is
     running — and if the reader walks away before it finishes, the setting was
     already written and the next visit reads the files off the disk. */
  useEffect(() => {
    if (!editorDownloading) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    listen("download:complete", () => {
      if (!active) return;
      setEditorDownloading(false);
      void reload();
    }).then((stop) => {
      if (active) unlisten = stop;
      else stop();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [editorDownloading, reload]);

  /* Events can be emitted between starting the backend thread and resolving the
     invoke call. Polling the small status object keeps the displayed phase
     truthful even when that first event raced past the WebView listener. */
  useEffect(() => {
    if (!running) return;
    let active = true;
    const refresh = async () => {
      try {
        const status = await api.aiEditStatus(recordingId);
        if (!active) return;
        setRunning(status.running);
        if (status.progress) setProgress(status.progress);
        if (status.document) setDocument(status.document);
        setOutputs(status.outputs);
      } catch {
        /* The event listener still reports terminal errors. */
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [recordingId, running]);

  return {
    state: {
      document,
      outputs,
      customDocuments,
      running,
      progress,
      configured,
      ready,
      dialog,
      mode,
      previewTab,
      previewScrolled,
      summaryLength,
      translationLanguage,
      originalPreview,
      customPrompt,
      writtenPrompt,
      customDocument,
      summaryOutput,
      translationOutput,
      previewText,
      editorOffer,
      editorDownloading,
      smallerOffer,
    },
    actions: {
      receive,
      receiveReadiness,
      open,
      closeDialog: () => setDialog(null),
      chooseMode: setMode,
      showTab: setPreviewTab,
      showOriginal,
      noteScrolled: setPreviewScrolled,
      chooseSummaryLength: setSummaryLength,
      chooseTranslationLanguage: setTranslationLanguage,
      writePrompt: setCustomPrompt,
      startEdit,
      startOutput,
      startCustomDocument,
      cancel,
      discard,
      regenerate,
      copyPreview,
      savePreview,
      saveImproved,
      acceptEditorOffer,
      dismissSmallerOffer: () => setSmallerOffer(null),
      retrySameEditor,
      takeSmallerEditor,
      markStale,
    },
  };
}
