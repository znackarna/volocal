import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { cs, en, type TranslationKey } from "./locales";

export type { TranslationKey };

/** Base name of a set of plural forms: `common.count.segment` when the
 *  dictionary holds `common.count.segment.one` and its siblings. Deriving it
 *  from the Czech dictionary means a plural key with no `.other` form is a
 *  compile error rather than a label that silently prints its own key. */
export type PluralKey = TranslationKey extends infer K
  ? K extends `${infer Base}.other`
    ? Base
    : never
  : never;

export type AppLanguage = "cs" | "en";

const STORAGE_KEY = "app-language";
const LOCALES: Record<AppLanguage, string> = { cs: "cs-CZ", en: "en-US" };

/** Czech is the source language: every key exists there. Other dictionaries may
 *  be incomplete while translation is in progress, so lookups fall back to
 *  Czech instead of rendering an empty label or a raw key. */
const dictionaries: Record<AppLanguage, Partial<Record<TranslationKey, string>>> = { cs, en };

function detectedLanguage(): AppLanguage {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "cs" || saved === "en") return saved;
  return navigator.languages.some((language) => language.toLowerCase().startsWith("cs"))
    ? "cs"
    : "en";
}

export type Values = Record<string, string | number>;

function interpolate(message: string, values?: Values): string {
  if (!values) return message;
  return message.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  );
}

export interface I18nValue {
  language: AppLanguage;
  locale: string;
  setLanguage: (language: AppLanguage) => void;
  /** Translates a known key. Missing translations fall back to Czech. */
  t: (key: TranslationKey, values?: Values) => string;
  /** Translates a key assembled at runtime, such as `domain.model.large-v3`.
   *  Identifiers coming from the backend cannot be checked at compile time, so
   *  this variant takes the raw identifier as its own fallback. */
  tDynamic: (key: string, fallback: string, values?: Values) => string;
  /** Picks the grammatical form matching `count`. Czech distinguishes four
   *  categories, English two, so the caller must never assemble the sentence
   *  itself. `{count}` is available to every form. */
  tPlural: (key: PluralKey, count: number, values?: Values) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatDate: (value: Date | number, options?: Intl.DateTimeFormatOptions) => string;
  /** Sorts the way the active language expects; Czech needs `ch` after `h`. */
  compare: (a: string, b: string) => number;
  /** Upper-cases the first character using the active language's casing rules. */
  capitalize: (value: string) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(detectedLanguage);

  const setLanguage = useCallback((next: AppLanguage) => {
    localStorage.setItem(STORAGE_KEY, next);
    setLanguageState(next);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo<I18nValue>(() => {
    const locale = LOCALES[language];
    const active = dictionaries[language];
    const plurals = new Intl.PluralRules(locale);
    const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });

    const lookup = (key: string): string | undefined =>
      active[key as TranslationKey] ?? cs[key as TranslationKey];

    const t = (key: TranslationKey, values?: Values) => interpolate(lookup(key) ?? key, values);

    return {
      language,
      locale,
      setLanguage,
      t,
      tDynamic: (key, fallback, values) => interpolate(lookup(key) ?? fallback, values),
      tPlural: (key, count, values) => {
        const category = plurals.select(count);
        const message = lookup(`${key}.${category}`) ?? lookup(`${key}.other`) ?? key;
        return interpolate(message, { count, ...values });
      },
      formatNumber: (value, options) => new Intl.NumberFormat(locale, options).format(value),
      formatDate: (value, options) => new Intl.DateTimeFormat(locale, options).format(value),
      compare: (a, b) => collator.compare(a, b),
      capitalize: (value) => (value ? value[0].toLocaleUpperCase(locale) + value.slice(1) : value),
    };
  }, [language, setLanguage]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
