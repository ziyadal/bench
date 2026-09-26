/**
 * What makes "fully translated" measurable: every English catalog string that differs from its
 * Spanish, searched for in what a Spanish page shows or speaks. A page that still says "Delete"
 * after the switch fails here, wherever the literal came from.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";

const src = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../web/src",
);

type Catalog = Record<string, string>;
const read = (app: string, lang: string) =>
  JSON.parse(
    readFileSync(path.join(src, app, "locales", `${lang}.json`), "utf8"),
  ) as Catalog;

/** The documents with catalogs of their own; the launcher's text is in the shared one. */
type App = "home" | "crm" | "space" | "rolodex" | "groove";

/**
 * An app's English values that differ from their Spanish, plus the strip's, split at the
 * {placeholders} so each fixed part is searched on its own. Per app, because one app's
 * vocabulary is another's data: CRM says "Status", and Space's seed has a property called that.
 */
function englishOnly(app: App): string[] {
  const out = new Set<string>();
  for (const dir of ["shared", app]) {
    if (!existsSync(path.join(src, dir, "locales"))) continue;
    const en = read(dir, "en");
    const es = read(dir, "es");
    for (const [key, value] of Object.entries(en)) {
      if (value === es[key]) continue;
      for (const part of value.split(/\{\w+\}/)) {
        const trimmed = part.trim();
        if (/[A-Za-z]/.test(trimmed)) out.add(trimmed);
      }
    }
  }
  return [...out];
}

/** Open the app in Spanish from the first paint, the way a returning Spanish visitor sees it. */
export async function inSpanish(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (!localStorage.getItem("bench.lang"))
      localStorage.setItem("bench.lang", "es");
  });
}

/**
 * Every string a person reads or a screen reader speaks: visible text nodes, option labels, and
 * the aria-label, title, placeholder and alt of every element.
 */
function shownText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      const text = node.textContent?.trim();
      if (!el || !text || ["SCRIPT", "STYLE"].includes(el.tagName)) continue;
      if (el.tagName === "OPTION" || el.checkVisibility()) out.push(text);
    }
    for (const el of document.body.querySelectorAll("*"))
      for (const attr of ["aria-label", "title", "placeholder", "alt"]) {
        const value = el.getAttribute(attr)?.trim();
        if (value) out.push(value);
      }
    return out;
  });
}

/**
 * A shown string leaks when it is an English catalog string, or contains one long enough that
 * it cannot be a coincidence of data. `data` names what the seed says on this screen: people,
 * pages and deals are the user's own and stay in whatever language they were written in.
 */
export async function expectNoEnglish(
  page: Page,
  app: App,
  data: (string | RegExp)[] = [],
): Promise<void> {
  const english = englishOnly(app);
  const isData = (text: string) =>
    data.some((d) => (typeof d === "string" ? text === d : d.test(text)));
  const leaks = (await shownText(page)).filter(
    (text) =>
      !isData(text) &&
      english.some(
        (en) => text === en || (en.split(" ").length >= 3 && text.includes(en)),
      ),
  );
  expect(leaks, `English on ${page.url()}`).toEqual([]);
}
