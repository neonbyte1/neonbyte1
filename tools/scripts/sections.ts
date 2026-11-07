/**
 * Generates heading banners for standalone README sections from profile/sections.json.
 *
 *   deno task sections
 *
 * Each section `{ "id", "title", "icon" }` becomes profile/headings/<id>.svg (same
 * banner style as the card groups; icon from tools/icons/) and fills the README
 * block between <!-- section:<id>:start --> and <!-- section:<id>:end -->. The `id`
 * keeps the markers stable when the title changes. README section markers without
 * a matching entry fail the run, so a removed section can't leave a dangling image.
 */

import { headingHtml, README, renderHeading, ROOT, syncSvgs, writeReadmeBlock } from "./shared.ts";

const CONFIG = new URL("profile/sections.json", ROOT);
const OUT_DIR = new URL("profile/headings/", ROOT);

interface Config {
  sections: { id: string; title: string; icon: string }[];
}

const config: Config = JSON.parse(await Deno.readTextFile(CONFIG));
const ids = new Set(config.sections.map((s) => s.id));

if (ids.size !== config.sections.length) {
  throw new Error("two sections share an id; profile/headings/<id>.svg would collide");
}

const orphans = [...(await Deno.readTextFile(README)).matchAll(/<!-- section:([\w-]+):start -->/g)]
  .map((m) => m[1])
  .filter((id) => !ids.has(id));

if (orphans.length > 0) {
  throw new Error(`README.md has section markers not in profile/sections.json: ${orphans.join(", ")}`);
}

await syncSvgs(
  OUT_DIR,
  new Map(
    await Promise.all(config.sections.map(async (s) => [`${s.id}.svg`, await renderHeading(s.title, s.icon)] as const)),
  ),
);

for (const section of config.sections) {
  await writeReadmeBlock(`section:${section.id}`, headingHtml(`profile/headings/${section.id}.svg`, section.title));
}

console.log(`generated ${config.sections.map((s) => s.title).join(", ")}`);
