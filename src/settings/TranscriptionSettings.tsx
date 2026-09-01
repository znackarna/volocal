/**
 * The `Přepis` tab: which model writes the text, how it is asked to, the words
 * it always gets wrong, and whether it separates the speakers.
 *
 * The largest of the seven, and it stays one panel because everything on it is
 * about the same act. The dictionary is the exception with data of its own,
 * which is why it arrives as a controller rather than as fields.
 */
import { useI18n } from "../i18n";
import type { TranslationKey } from "../i18n";
import { useLabels } from "../labels";
import { useFormats } from "../formats";
import { useUserMessage } from "../messages";
import InfoNote from "../InfoNote";
import Select from "../Select";
import { LineIcon, ModelMark, type LineIconName } from "../icons";
import { SettingsToggle } from "./toggle";
import { SettingsDisclosure } from "./disclosure";
import type { DownloadComponent, Settings, ToolCheck } from "../types";
import type { Dictionary } from "./useDictionary";

/** How each language-editing model is drawn and named on its card.
 *
 *  One square at three sizes: size is the only thing known about the difference
 *  between these models, so it is the only thing the drawing says — see the
 *  comment on the three glyphs in `icons.tsx`. The middle one is here for the
 *  machines that hold it; nothing fetches it, and a model the screen names has
 *  to have a mark like its neighbours or the mark starts to look like a rank.
 *
 *  The names are one word each and are **not** the catalogue's. Under a heading
 *  reading `Jazyková úprava` the noun is supplied and `Menší` is right; in
 *  `Stahuji {name}` and in the by-hand list the name stands alone and has to
 *  say what the thing is, which is why the catalogue calls the same component
 *  `Menší model jazykové úpravy`. Two jobs, two strings. The sentence under each
 *  card is still the catalogue's, because that one reads correctly in both. */
const EDITOR_CARDS: Record<string, { icon: LineIconName; title: TranslationKey }> = {
  "editor-model-best": { icon: "sizeLarge", title: "settings.editor.modelLarge" },
  "editor-model-balanced": { icon: "sizeMedium", title: "settings.editor.modelMiddle" },
  "editor-model-light": { icon: "sizeSmall", title: "settings.editor.modelSmall" },
};

/** What `Pokročilé` puts back, and what tells it whether anything has moved.
 *
 *  Every one of these is a value with a right answer that somebody may have a
 *  reason to disagree with: the beam width, the five thresholds Whisper decides
 *  a segment by, and where the work runs. The numbers are whisper.cpp's own,
 *  from `examples/cli/cli.cpp`, except the entropy threshold — 2.6 rather than
 *  2.4, because on Czech the model looped more often than whisper's own
 *  threshold was willing to catch. They match `Settings::default` in `db.rs`,
 *  which is what a fresh installation gets; the two lists have to agree, or a
 *  new installation would open badged as modified.
 *
 *  The two folders in that block are deliberately not here — see the comment
 *  where the block is drawn.
 *
 *  `compute` is not here, and now has a control again — on `Nástroje`, beside
 *  the line that says what actually ran. It stays out because `Zpět na výchozí`
 *  restores what this block shows: a badge reading `upraveno` about a control
 *  on another tab, and a button that quietly moved it, would be a reset nobody
 *  watching it could see. Automatic is one press away where the control is. */
const ADVANCED_DEFAULTS = {
  beam: 5,
  threshold_silence: 0.6,
  threshold_confidence: -1,
  entropy_threshold: 2.6,
  temperature: 0,
  temperature_increment: 0.2,
} as const satisfies Partial<Settings>;

/** The five thresholds, as sliders. `whisper.rs` sends `--no-speech-thold`,
 *  `--logprob-thold`, `--entropy-thold`, `--temperature` and
 *  `--temperature-inc` whenever they differ from whisper's defaults, and asks
 *  nothing else first — which is why they are shown unconditionally. They used
 *  to appear only while speech detection was on, so a value that was being
 *  passed to the transcription could be invisible on this screen. */
const DECODING_FIELDS: ReadonlyArray<{
  key: "threshold_silence" | "threshold_confidence" | "entropy_threshold"
    | "temperature" | "temperature_increment";
  labelKey: TranslationKey;
  min: number;
  max: number;
  step: number;
  descriptionKey: TranslationKey;
}> = [
  {
    key: "threshold_silence",
    labelKey: "settings.decoding.silence",
    min: 0,
    max: 1,
    step: 0.05,
    descriptionKey: "settings.decoding.silenceNote",
  },
  {
    key: "threshold_confidence",
    labelKey: "settings.decoding.confidence",
    min: -3,
    max: 0,
    step: 0.1,
    descriptionKey: "settings.decoding.confidenceNote",
  },
  {
    key: "entropy_threshold",
    labelKey: "settings.decoding.entropy",
    min: 1,
    max: 5,
    step: 0.1,
    descriptionKey: "settings.decoding.entropyNote",
  },
  {
    key: "temperature",
    labelKey: "settings.decoding.temperature",
    min: 0,
    max: 1,
    step: 0.1,
    descriptionKey: "settings.decoding.temperatureNote",
  },
  {
    key: "temperature_increment",
    labelKey: "settings.decoding.temperatureStep",
    min: 0,
    max: 0.5,
    step: 0.05,
    descriptionKey: "settings.decoding.temperatureStepNote",
  },
];

/** The id the dictionary's unwritten row wears while it is in the table and
 *  not yet in the archive. Every saved entry's id is a uuid from the backend,
 *  so this cannot be one of them. */
const DRAFT_ROW = "draft-row";

/** Both halves of an unwritten row. Named once because three places make one —
 *  the button under the table, and either field when the row standing in an
 *  empty table takes its first character. */
const EMPTY_DRAFT = { find: "", replace: "" };

/** The model cards, both kinds, worked out by the screen: choosing one may
 *  start a download and ask about its size first, and that question is the
 *  screen's. */
export interface ModelChoices {
  transcription: Array<{
    id: string;
    component?: string;
    installed: boolean;
    megabytes: number;
  }>;
  /** The model that will actually transcribe, which is not always the one on
   *  record — a file deleted by hand, a choice made before its download
   *  finished. */
  inForce: string;
  chooseTranscription: (card: { id: string; component?: string; installed: boolean }) => void;
  editors: Array<DownloadComponent & { needs: string[]; needsMb: number }>;
  editorChosen: string;
  chooseEditor: (id: string, needs: string[]) => void;
  /** Which component is coming down right now, if any. */
  fetchingComponent: string;
}

export function TranscriptionSettings({
  n,
  check,
  save,
  dictionary,
  models,
}: {
  n: Settings;
  check: ToolCheck | null;
  save: (next: Settings) => void;
  dictionary: Dictionary;
  models: ModelChoices;
}) {
  const { t, tDynamic, formatNumber } = useI18n();
  const labels = useLabels();
  const formats = useFormats();
  const userMessage = useUserMessage();

  /* Whether anything folded away has been moved off its default. The badge and
     the reset button are one question asked twice, so they are one expression:
     a block that says `upraveno` and a button that refuses to do anything would
     be worse than neither. */
  const advancedChanged = (
    Object.keys(ADVANCED_DEFAULTS) as Array<keyof typeof ADVANCED_DEFAULTS>
  ).some((key) => n[key] !== ADVANCED_DEFAULTS[key]);

  /* The row being written is a row of the table, so one block of markup draws
     it and the saved ones together rather than a copy of that block standing
     above them. An empty table stands as one unwritten row rather than a
     sentence saying it is empty. */
  const entries = dictionary.state.entries;
  const draft = dictionary.state.draft;
  const dictionaryRows = draft || entries.length === 0
    ? [...entries, { id: DRAFT_ROW, find: draft?.find ?? "", replace: draft?.replace ?? "" }]
    : entries;

  return (
    <>
      <section className="settings-card-language-edit">
        <h2>{t("settings.editor.title")}</h2>
        <p className="settings-section-description">{t("settings.editor.description")}</p>

        <div className="choices">
          {models.editors.map((card) => (
            <button
              key={card.id}
              className={`choice with-icon ${card.id === models.editorChosen ? "chosen" : ""}`}
              aria-pressed={card.id === models.editorChosen}
              onClick={() => void models.chooseEditor(card.id, card.needs)}
            >
              <span className="choice-icon" aria-hidden>
                <LineIcon name={EDITOR_CARDS[card.id].icon} />
              </span>
              <span className="choice-body">
                <span className="choice-title">{t(EDITOR_CARDS[card.id].title)}</span>
                <span className="small-text">{tDynamic(card.description_code, "")}</span>
              </span>
              {/* The same pair as the transcription cards above: the badge
                  where it is a fact about the disk, the size where pressing the
                  card starts a download of that many gigabytes — the model, and
                  the runtime too where that is not there yet. */}
              {card.needs.length === 0 ? (
                <em className="badge complete">{t("wizard.download.downloadedBadge")}</em>
              ) : (
                <span className="choice-size">{formats.dataSize(card.needsMb)}</span>
              )}
            </button>
          ))}
        </div>

        {/* Why nothing has happened yet, and why that is not a fault. It was a
            red `field-prompt` reading *not downloaded yet*, which is a colour
            that says something is wrong about work nobody has asked for. */}
        <InfoNote compact>{t("settings.editor.note")}</InfoNote>
      </section>

      <section className="settings-card-advanced">
        <SettingsDisclosure
          title={t("settings.advanced.title")}
          badge={
            advancedChanged ? (
              <span className="badge quiet">{t("settings.advanced.modified")}</span>
            ) : undefined
          }
        >
        <p className="small-text">{t("settings.advanced.note")}</p>

        <div className="field">
          <label>
            {t("settings.transcription.beam")} <em className="value">
              {formatNumber(n.beam)}
            </em>
          </label>
          <input
            type="range"
            min={1}
            max={8}
            value={n.beam}
            onChange={(e) => save({ ...n, beam: Number(e.target.value) })}
          />
          <p className="small-text">{t("settings.transcription.beamNote")}</p>
        </div>

        {/* The five thresholds Whisper decides by. They are here whatever else
            is set, which they were not: they used to be revealed by the speech
            detection switch, and `whisper.rs` writes `--temperature`,
            `--logprob-thold`, `--entropy-thold`, `--temperature-inc` and
            `--no-speech-thold` without ever consulting it. A value that is
            being sent must be visible. */}
        {DECODING_FIELDS.map((p) => (
          <div className="field" key={p.key}>
            <label>
              {t(p.labelKey)} <em className="value">{formatNumber(n[p.key])}</em>
            </label>
            <input
              type="range"
              min={p.min}
              max={p.max}
              step={p.step}
              value={n[p.key]}
              onChange={(e) => save({ ...n, [p.key]: Number(e.target.value) })}
            />
            <p className="small-text">{t(p.descriptionKey)}</p>
          </div>
        ))}

        {/* `Vlákna procesoru` stood here and is gone. Zero — the default and
            what almost every installation carried — already means
            `available_parallelism`, and every measured value above it was
            slower, because whisper.cpp is memory-bound long before it runs out
            of cores. A number that can only make things worse is not a setting.

            `Akcelerace zpracování` stood here too, four choice cards deciding
            where the work runs, and `Změřit rychlost` under them. Both are
            gone: the machine reads its own drivers, and a reader who picks a
            backend can only pick a slower one or one this computer cannot run
            — which `choose_compute` then quietly replaces, leaving the screen
            badging `používá se` on something that never ran. What ran is on
            `Nástroje` now, in a card that can also say when the graphics card
            was asked for and could not be used. */}

        <button
          className="button"
          disabled={!advancedChanged}
          onClick={() => save({ ...n, ...ADVANCED_DEFAULTS })}
        >
          {t("settings.advanced.reset")}
        </button>
        </SettingsDisclosure>
      </section>

      <section className="settings-card-dictionary">
        <h2>{t("settings.dictionary.title")}</h2>
        <p className="settings-section-description">{t("settings.dictionary.description")}</p>

        {/* The composer stood here — a labelled `Nový výraz` row of two fields
            and a `Přidat` button, above the table it filled. It is gone on the
            owner's word: *dejme pryč ten současný formulář ale dejme tam
            tlačítko které umožní přidat nový řádek té tabulce*.

            The reason it is right beyond being asked for: the card said the
            same thing twice, in two shapes. A form above a table is a second
            drawing of the table's own row — two marks, two fields, one on top
            of the other — and the reader had to learn that the boxes above and
            the boxes below are the same two columns. They are one thing now:
            the table, and a button that lengthens it. */}
        <div className="dictionary-saved">
              {/* The empty state stood around this list — `dictionaryRows` is
                  never empty now, because a table with nothing in it draws the
                  unwritten row instead, and a branch that cannot be taken is
                  worse than no branch. */}
              {/* `Co přepis slyší` and `Jak to má být` stood here, one over each
                  column — *tyhle dva popisky dej pryč, nejsou nutné*.

                  They were written when a row was two bare words and the reader
                  had to work out which half was the error. A row is not that any
                  more: the red cross and the green tick say it on the fields
                  themselves, per row, and the card's opening sentence says what
                  the pair is for. Two headings over two marks that already speak
                  is the same thing said twice.

                  The sentence is not lost for anyone reading with something
                  other than their eyes: both keys stay, on each input as its
                  `aria-label`, which is where a field's name belongs. */}
              <ul className="dictionary-list">
              {dictionaryRows.map((entry) => {
                /* The last row is the one being written when there is one. It
                   is drawn by this same block — same marks, same columns, same
                   height — and differs only in where its text goes and what
                   leaving it means. */
                const writing = entry.id === DRAFT_ROW;
                return (
                <li
                  key={entry.id}
                  /* Leaving the unwritten row decides it. `onBlur` bubbles, so
                     this catches either half; moving from one half to the other
                     is not leaving, which is what `relatedTarget` answers. */
                  onBlur={writing ? (event) => {
                    if (event.currentTarget.contains(event.relatedTarget)) return;
                    dictionary.actions.closeDraft();
                  } : undefined}
                >
                  {/* A mark in front of each half instead of an arrow between
                      them — *tu šipku ze slovníku dejme pryč, je zbytečná*. An
                      arrow says *this becomes that* and leaves the reader to
                      decode it from the direction it points; a red cross and a
                      green tick say *this one is wrong* and *this one is right*
                      on the fields themselves, so a row is legible from either
                      end rather than only from the left.

                      They are marks and not buttons: no hover, no pointer, and
                      `aria-hidden`, because the row's only action is the bin
                      and the meaning is already on each input as its
                      `aria-label`. The glyphs differ as well as the colours —
                      red against green alone is not a distinction every reader
                      has. */}
                  <span className="dictionary-pair">
                    {/* The heading's own words, on the mark that replaced it.
                        Taking `Co přepis slyší` off the screen was right — it
                        was said on every row by this circle — but the first
                        time somebody meets a red circle they may still want the
                        sentence. Hovering the thing that says it is where to
                        ask, and it costs no room while nobody is asking.

                        `title` and not `aria-label`: the application draws its
                        own bubble from `title`, and the field beside this mark
                        already carries the same string as its accessible name.
                        A second copy here would read every row twice. */}
                    <span
                      className="dictionary-mark wrong"
                      title={t("settings.dictionary.find")}
                      aria-hidden
                    >
                      <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
                        <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor"
                              strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </span>
                    <input
                      /* The callback ref is what puts the cursor in a row the
                         moment the button makes it; `startDraft` uses the same
                         node for the second press, when there is nothing to
                         mount.

                         `draft` and not `writing`: the row standing in an empty
                         table is there before anybody asked for it, and a field
                         that takes the cursor because a table happens to be
                         empty would move it out of whatever the reader opened
                         Settings for. The ref attaches on the first keystroke
                         instead, where `focus()` lands on the field already
                         being typed into and does nothing. */
                      ref={writing && draft ? dictionary.actions.holdDraftField : undefined}
                      value={entry.find}
                      onChange={(event) => {
                        const value = event.target.value;
                        /* Typing into the standing row is what makes it a draft,
                           so this starts one rather than requiring one. */
                        if (writing) dictionary.actions.writeDraft((current) => ({ ...(current ?? EMPTY_DRAFT), find: value }));
                        else dictionary.actions.edit(entry.id, { find: value });
                      }}
                      onBlur={writing ? undefined : () => void dictionary.actions.save(entry)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        /* On a row being written, Enter is *next*, not *done* —
                           blurring here would leave a half-filled row, and half
                           a row is thrown away rather than saved. */
                        if (writing) dictionary.actions.focusReplaceField();
                        else event.currentTarget.blur();
                      }}
                      placeholder={writing ? t("settings.dictionary.findPlaceholder") : undefined}
                      aria-label={t("settings.dictionary.find")}
                      spellCheck={false}
                    />
                  </span>
                  <span className="dictionary-pair">
                    {/* The same tick as the release notes' list and the
                        listing's installed mark, at the same 10 px: one drawing
                        for *this is the good one* wherever the application says
                        it. Its half of the sentence on hover, for the reason
                        the cross carries. */}
                    <span
                      className="dictionary-mark right"
                      title={t("settings.dictionary.replace")}
                      aria-hidden
                    >
                      <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
                        <path d="M3 7.2 5.7 10 11 4.5" stroke="currentColor" strokeWidth="2"
                              strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <input
                      ref={writing ? dictionary.actions.holdReplaceField : undefined}
                      value={entry.replace}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (writing) dictionary.actions.writeDraft((current) => ({ ...(current ?? EMPTY_DRAFT), replace: value }));
                        else dictionary.actions.edit(entry.id, { replace: value });
                      }}
                      onBlur={writing ? undefined : () => void dictionary.actions.save(entry)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                      placeholder={writing ? t("settings.dictionary.replacePlaceholder") : undefined}
                      aria-label={t("settings.dictionary.replace")}
                      spellCheck={false}
                    />
                  </span>
                  {/* The bin, the same drawing and the same box as the row it
                      now shares its shape with. A cross stood here, which is
                      the mark for closing something; deleting is a bin
                      everywhere else in the application, and the two acts are
                      different enough that they must not wear one mark.

                      It is not drawn on the row standing in an empty table
                      while nothing has been typed into it: that row cannot be
                      thrown away — the table would draw it again — so a bin
                      there would promise something it cannot do, which is the
                      fault the listing's lock was built to stop telling. The
                      first character makes it a draft and the bin appears with
                      its ordinary meaning: what you typed goes. The 26 px
                      column is declared in `grid-template-columns`, so an empty
                      cell moves nothing. */}
                  {(!writing || draft) && <button
                    type="button"
                    className="dictionary-remove"
                    title={t("common.delete")}
                    aria-label={t("common.delete")}
                    /* On a row being written, the press must not first take the
                       focus out of the field: leaving decides the row, so the
                       row would be gone — or saved — before the click landed on
                       it. Holding the focus lets the bin mean one thing on both
                       kinds of row: this row goes. */
                    onMouseDown={writing ? (event) => event.preventDefault() : undefined}
                    onClick={() => {
                      if (writing) dictionary.actions.writeDraft(null);
                      else void dictionary.actions.remove(entry.id);
                    }}
                  >
                    <LineIcon name="remove" size={16} />
                  </button>}
                </li>
                );
              })}
              </ul>
          {/* 22 px under a bordered panel and no rule with it — the amount and
              the reason `.settings-action-row.spaced` already carries, since a
              rule drawn under a panel draws the same boundary twice.

              A note at the left and the action at the right, which is what this
              row is `space-between` for: the button had been standing alone at
              the left end, where a lone child lands. The sentence is the one
              thing about this table a reader cannot see — there is no saving to
              do, and an unfinished row is not kept. It could only ever be
              learned by trying it, which is the worst way to learn what happens
              to something you typed. */}
          <div className="settings-action-row spaced">
            <InfoNote>{t("settings.dictionary.saving")}</InfoNote>
            <button className="button" onClick={dictionary.actions.startDraft}>
              {t("settings.dictionary.add")}
            </button>
          </div>
        </div>
      </section>

      <section className="settings-card-transcription">
        <h2>{t("settings.transcription.model")}</h2>

        <div className="field">
          {/* Cards rather than a dropdown: what separates these models is what
              they do with time and accuracy, and that does not fit on a line.

              **This list is an offer, not an inventory.** `Přesný` and `Rychlý`
              are always on it and pressing one that is not downloaded fetches
              it — *chybějící model se výběrem automaticky stáhne* — which is the
              same shape the two cards on `Jazyková úprava` have and the reason
              they were built that way first. Before that the list was
              `found_models` alone and the note sent the reader to another tab
              to get anything else, which is two screens for one decision.

              Anything else already on the disk is drawn beside them, sorted
              into the same order: `large-v3-q5_0` on a machine set up before
              13 August 2026, an older generation, anything a hand put there. A
              list that is partly an offer must not hide what the disk holds, or
              a reader whose model is not one of the two would find their own
              choice missing from the screen that names it. */}
          <div className="choices model-choices">
            {models.transcription.map((card) => (
              <button
                key={card.id}
                className={`choice with-icon ${models.inForce === card.id ? "chosen" : ""}`}
                onClick={() => void models.chooseTranscription(card)}
                aria-pressed={models.inForce === card.id}
              >
                <span className="choice-icon" aria-hidden>
                  <ModelMark id={card.id} />
                </span>
                <span className="choice-body">
                  <span className="choice-title">{labels.model(card.id)}</span>
                  <span className="small-text">
                    {labels.modelDescription(
                      card.id,
                      t("settings.transcription.modelDescription")
                    )}
                  </span>
                </span>
                {/* `staženo` is the badge `.complete`, not the size slot
                    wearing the word. The wizard has always drawn it as a badge
                    on the same two models, and a fact stated as a pill on one
                    screen and as quiet right-aligned type on another is the
                    drift, not a variation. What stays in the size slot is what
                    is genuinely a size, plus the one state that is neither:
                    a model on its way, which is progress rather than a fact
                    about the disk. */}
                {card.installed ? (
                  <em className="badge complete">{t("wizard.download.downloadedBadge")}</em>
                ) : (
                  <span className="choice-size">
                    {card.component && card.component === models.fetchingComponent
                      ? t("settings.transcription.modelDownloading")
                      : formats.dataSize(card.megabytes)}
                  </span>
                )}
                {/* A `používá se` badge stood here, on the card already drawn
                    as chosen. Checked rather than assumed before deleting it:
                    the badge appeared exactly on the card `n.model` names and
                    that card is the chosen one, so it never said anything the
                    highlight did not. */}
              </button>
            ))}
          </div>
          <InfoNote>{t("settings.transcription.modelNote")}</InfoNote>
        </div>

      </section>

      <section className="settings-card-language">
        <h2>{t("settings.transcription.language")}</h2>

        {/* No label above the dropdown: the heading is the label, and a card
            headed `Jazyk nahrávky` over a field labelled `Jazyk nahrávky` says
            it twice. `Select` takes the name for screen readers instead, which
            is what `description` is for. */}
        <div className="field">
          <Select
            value={n.language}
            onChange={(j) => save({ ...n, language: j })}
            items={labels.languageOptions()}
            description={t("settings.transcription.language")}
          />
          <InfoNote>{t("settings.transcription.languageNote")}</InfoNote>
        </div>
      </section>

      <section className="settings-card-speakers">
        {/* Back to the `heading` variant, and the round trip is the record.

            An hour ago this card was given three lines — `Mluvčí`, then
            `Rozlišení mluvčích` on the switch, then the sentence — and the card
            was rebuilt to hold them. The owner then moved the longer phrase up
            into the heading and dropped the bare noun: *Rozlišení mluvčích
            použij MÍSTO toho jednoduchého nadpisu.* That leaves two lines, and
            a switch row with nothing distinct left to call itself.

            So the heading is the switch row again, which is what this variant
            is for: `<h2>` and the control on one line, the sentence under both.
            The alternative — keeping a separate `<h2>` and letting the switch
            carry no visible label — would have drawn an empty caption column
            beside the heading and made the row taller for nothing.

            One key does both jobs now. `settings.speakers.title` is the heading
            and the switch's name for screen readers; `settings.speakers.toggle`
            held the middle line and is retired with it. */}
        <SettingsToggle
          title={t("settings.speakers.title")}
          label={t("settings.speakers.title")}
          checked={n.diarization}
          heading
          onChange={(checked) => save({ ...n, diarization: checked })}
          description={t("settings.speakers.description")}
        />

        {/* Off by default. It costs a few seconds on every run and answers a
            question most recordings never raise; where the reader knows a
            recording holds two languages, naming them on it is surer. */}
        <SettingsToggle
          title={t("settings.secondLanguage.title")}
          label={t("settings.secondLanguage.title")}
          checked={n.detect_second_language}
          heading
          onChange={(checked) => save({ ...n, detect_second_language: checked })}
          description={t("settings.secondLanguage.description")}
        />

        {/* Two controls stood here and both are gone.

            `Počet mluvčích` was overridden every time it could have mattered:
            with recognition on, the dialog asks before every run and its answer
            replaces the stored number. The one case where the stored value did
            apply was the reader pressing `Nevím` — so the answer meaning
            *estimate it* silently applied whatever number was left in Settings,
            and a count at or above the number of voice windows collapses the
            whole recording into a single speaker. Removing it is what makes
            `Nevím` mean what it says.

            `Hledání změn mluvčího` promised a measurable trade — `Podrobně`
            carried the note *až dvakrát déle* — and delivered neither half:
            `segmentation_window_shift` is written here and read by no Rust
            code, because the sherpa segmentation binary it configured was
            removed. The field stays in the settings record so an archive
            written by an older build still loads; nothing sets it. */}

        {check && check.issues_diarization.length > 0 && n.diarization && (
          <ul className="problems">
            {check.issues_diarization.map((p, i) => (
              <li key={i}>{userMessage(p)}</li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
