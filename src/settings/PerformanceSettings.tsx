/**
 * The `Výkon` tab: where the transcript is computed.
 *
 * The card was reported flashing a red refusal that took itself back a
 * fraction of a second later — the rule was never wrong about the values it
 * was given, it was given a fresh question and a stale answer. That pairing is
 * `checkedCompute`: the check is only read against the settings it answered
 * for. `compute.test.ts` pins the rule, `compute.test.tsx` pins this wiring.
 */
import { useI18n } from "../i18n";
import type { TranslationKey } from "../i18n";
import InfoNote from "../InfoNote";
import { LineIcon, type LineIconName } from "../icons";
import { computeMode, computeRefused as computeWasRefused } from "../compute";
import { SettingsToggle } from "./toggle";
import type { Settings, ToolCheck } from "../types";

const COMPUTE_CHOICES = [
  { value: "gpu", icon: "graphicsCard", title: "settings.compute.modeGpu",
    note: "settings.compute.modeGpuNote" },
  { value: "cpu", icon: "compute", title: "settings.compute.modeCpu",
    note: "settings.compute.modeCpuNote" },
] as const satisfies ReadonlyArray<{
  value: string;
  icon: LineIconName;
  title: TranslationKey;
  note: TranslationKey;
}>;

/** Which component carries the build for each backend. */
const COMPUTE_MODULES: Record<string, string> = {
  cuda: "whisper-cuda",
  vulkan: "whisper-vulkan",
  cpu: "whisper-cpu",
};

export function PerformanceSettings({
  n,
  check,
  checkedCompute,
  save,
  onToModule,
}: {
  n: Settings;
  check: ToolCheck;
  /** Which compute the check on hand answered for. */
  checkedCompute: string | null;
  save: (next: Settings) => void;
  /** Walks to the component list, with the missing build named. */
  onToModule: (module?: string) => void;
}) {
  const { t } = useI18n();

  /* `check.compute` is what `choose_compute` answered, which is the folder the
     next transcription's `whisper-cli` comes out of — not what is stored. The
     two differ exactly when the stored choice cannot be honoured here, and
     saying that out loud is what this card is for. */
  const computeRunning = check.compute ?? "";
  const onGraphicsCard = computeRunning === "cuda" || computeRunning === "vulkan";
  const hasGraphicsDriver = !!(check.nvidia_driver || check.vulkan_driver);
  const computeChoice = computeMode(n.compute);
  const graphicsCardBackend = check.nvidia_driver ? "cuda" : "vulkan";
  /** Something was picked and is not what ran. The chosen card goes red for it —
   *  the one case where the card has to contradict the choice drawn on it — and
   *  the sentence under the cards carries the reason. The rule and the reason it
   *  needs `checkedCompute` are in `compute.ts`. */
  const computeRefused = computeWasRefused(n.compute, checkedCompute, check);
  /** Which card is highlighted. With the switch on nothing was picked, so it is
   *  what the drivers settled on — the switch's effect made visible, which is
   *  the reason the cards stay on screen while it is on. With the switch off it
   *  is the pick, honoured or not. */
  const computeShown = computeChoice === "auto" ? (onGraphicsCard ? "gpu" : "cpu") : computeChoice;
  /** The build for the graphics card was never downloaded, with a driver that
   *  could have run it. The one reason for a card standing idle that the reader
   *  can fix from here, so wherever it is said the row carries a button. */
  const graphicsCardMissing =
    hasGraphicsDriver &&
    !onGraphicsCard &&
    !!computeRunning &&
    !(check.available_compute_backends ?? []).includes(graphicsCardBackend);

  return (
      check && <section className="settings-card-compute">
        <h2>{t("settings.compute.title")}</h2>
        <p className="settings-section-description">{t("settings.compute.description")}</p>

        {/* No `používá se` on the highlighted card. A card drawn as chosen
            already says it is the one, and two marks for one fact is noise. The
            model cards on `Přepis` lost the same badge for the same reason.

            What the badge was carrying has to stay, though, and it is the
            opposite case: `choose_compute` substitutes another backend when the
            chosen one cannot be used, and this card exists because that used to
            be silent. So the card is quiet when it agrees and speaks when it
            does not — the card wears `missing`, the danger colour the module
            tiles use, and the sentence below gives the reason and the way out.
            An empty state here is correct; do not fill it.

            While the switch is on, what is highlighted is what ran rather than
            what was picked, because nothing was picked. That is also why the
            red state cannot occur there: with nobody's instruction to
            contradict, `choose_compute`'s answer is simply the answer. */}
        <div className="choices">
          {COMPUTE_CHOICES.map((choice) => {
            const shown = computeShown === choice.value;
            return (
              <button
                key={choice.value}
                className={`choice with-icon ${shown ? "chosen" : ""} ${
                  shown && computeRefused ? "missing" : ""
                }`}
                aria-pressed={shown}
                onClick={() => save({ ...n, compute: choice.value })}
              >
                <span className="choice-icon" aria-hidden>
                  <LineIcon name={choice.icon} />
                </span>
                <span className="choice-body">
                  <span className="choice-title">{t(choice.title)}</span>
                  <span className="small-text">{t(choice.note)}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* The switch reads as a qualifier on what is above it — *and let the
            application decide which* — which is exactly what it does, so it
            stands under the cards rather than over them. It also settles what
            the cards do while it is on: they stay, because somebody can then
            see where their transcript runs without touching anything.

            The sentence about the application choosing lives on the control
            that does the choosing, so it is only ever on screen while it is
            true. It stood under the cards in every state before this — under a
            card somebody had deliberately picked it was simply wrong, and the
            owner struck it out.

            The plain row and not `heading` — *to automaticky nedávej jako
            nadpis ale dej to jako text před ten toggle*. `heading` renders an
            `<h2>` and makes the row a section switch, which would give this card
            a second heading below its own and claim everything under it as a new
            section. Same shape as `Přepisovat nové soubory automaticky` and
            `Kopírovat přidané soubory`: a 15/680 title with the switch opposite
            it and its sentence underneath. */}
        <SettingsToggle
          title={t("settings.compute.letItDecide")}
          label={t("settings.compute.letItDecide")}
          checked={computeChoice === "auto"}
          description={t("settings.compute.autoNote")}
          /* Off has to leave something sensible chosen, and the only sensible
             thing is what the machine is already doing. Jumping to the other
             card, or to an empty state, would make this a switch that changes
             where the work runs — and it does not; it changes who decides. */
          onChange={(automatic) =>
            save({ ...n, compute: automatic ? "auto" : onGraphicsCard ? "gpu" : "cpu" })
          }
        />

        {/* Under the switch, and only where there is something to say. A
            `Používá se — Procesor (CPU)` row stood here below a sentence about
            the application choosing, under a card already drawn as chosen:
            three statements of one fact, and the owner struck two of them out.

            Picked and running where it was asked to is therefore silent — the
            highlighted card is the whole answer, and the way back is the switch
            above rather than a button repeating it. `Vybraná varianta platí i
            tam, kde by aplikace zvolila jinak` was that button's sentence and
            went with it: a switch that is visibly off already says nobody is
            choosing over the reader. */}
        {computeRefused ? (
          /* The one case worth ink: the application is contradicting an
             instruction. `choose_compute` substitutes in silence by design,
             because a transcription must run, and this is the one place it is
             said out loud — what ran, and why the pick could not be met. A
             missing build is offered; a missing driver is not something a
             download fixes, and that sentence carries no button. */
          <div className="settings-action-row spaced">
            <InfoNote compact>
              {t(
                computeChoice === "cpu"
                  ? "settings.compute.processorRefused"
                  : hasGraphicsDriver
                    ? "settings.compute.graphicsCardRefused"
                    : "settings.compute.noGraphicsCard"
              )}
            </InfoNote>
            {(computeChoice === "cpu" || hasGraphicsDriver) && (
              <button
                className="button"
                onClick={() =>
                  onToModule(
                    computeChoice === "cpu"
                      ? COMPUTE_MODULES.cpu
                      : COMPUTE_MODULES[graphicsCardBackend]
                  )
                }
              >
                {t("common.download")}
              </button>
            )}
          </div>
        ) : computeChoice === "auto" && !hasGraphicsDriver ? (
          /* Nothing is wrong here and nothing was refused; it is a fact about
             the machine, and the only reason to say it is that the graphics
             card is one of two cards on the screen. */
          <InfoNote compact>{t("settings.compute.noGraphicsCard")}</InfoNote>
        ) : computeChoice === "auto" && graphicsCardMissing ? (
          /* A card sitting idle with nobody having picked anything means its
             build was never downloaded — which the reader can fix from here. */
          <div className="settings-action-row spaced">
            <InfoNote compact>{t("settings.compute.graphicsCardIdle")}</InfoNote>
            <button
              className="button"
              onClick={() => onToModule(COMPUTE_MODULES[graphicsCardBackend])}
            >
              {t("common.download")}
            </button>
          </div>
        ) : null}
      </section>
  );
}
