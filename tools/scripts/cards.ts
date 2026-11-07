/**
 * Generates the "Featured work" project cards from profile/cards.json.
 *
 *   deno task cards
 *
 * Cards are listed per group; each group gets a neon heading banner (its
 * `title` plus an `icon` from tools/icons/) followed by its cards.
 * `repo` is a repo of `user`, or `owner/name` for someone else's project.
 * Per card: description and language default to the GitHub repo's metadata;
 * `description`, `language` and `tag` in cards.json override/extend them, and
 * `url` replaces the link target (default: the repo page).
 * `contributor: true` adds a "contributor" badge, and fails unless `user` has at
 * least one merged PR in a repo of that owner (org-wide, so connector/plugin
 * repos count for the main project).
 * Writes profile/cards/<name>.svg and profile/cards/headings/<group>.svg, removes ones
 * no longer listed, and rewrites the README block between <!-- cards:start -->
 * and <!-- cards:end -->.
 * Set GITHUB_TOKEN to lift the anonymous API rate limits (60 requests/hour,
 * 10 searches/minute).
 */

import {
  BG,
  CYAN,
  escapeXml,
  FG,
  headingHtml,
  MUTED,
  PINK,
  renderHeading,
  ROOT,
  SANS,
  slugify,
  syncSvgs,
  writeReadmeBlock,
} from "./shared.ts";

const CONFIG = new URL("profile/cards.json", ROOT);
const CARD_DIR = new URL("profile/cards/", ROOT);
const HEADING_DIR = new URL("profile/cards/headings/", ROOT);

/** Description wrap width in characters (≈392px at 13.5px sans) and max lines. */
const LINE_CHARS = 50;
const MAX_LINES = 2;

/** Linguist colors; unknown languages fall back to MUTED. */
const LANGUAGE_COLORS: Record<string, string> = {
  "C": "#555555",
  "C++": "#f34b7d",
  "C#": "#178600",
  "Dockerfile": "#384d54",
  "Go": "#00add8",
  "JavaScript": "#f1e05a",
  "Jinja": "#a52a22",
  "Lua": "#000080",
  "PHP": "#4f5d95",
  "Python": "#3572a5",
  "Rust": "#dea584",
  "Shell": "#89e051",
  "TypeScript": "#3178c6",
  "Vue": "#41b883",
  "Zig": "#ec915c",
};

const REPO_ICON =
  "M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z";

/** Octicons git-merge-16. */
const MERGE_ICON =
  "M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0 0 .005V3.25Z";

interface CardConfig {
  repo: string;
  tag?: string;
  description?: string;
  language?: string;
  contributor?: boolean;
  /** Where the card links to; defaults to the repo page. */
  url?: string;
}

interface Config {
  user: string;
  groups: { title: string; icon: string; cards: CardConfig[] }[];
}

interface Card {
  /** Set only for repos not owned by the profile user; shown as a muted prefix. */
  owner: string | null;
  name: string;
  url: string;
  description: string;
  language: string | null;
  tag: string | null;
  contributor: boolean;
}

interface Group {
  title: string;
  slug: string;
  /** Icon name in tools/icons/. */
  icon: string;
  cards: Card[];
}

function wrap(text: string): string[] {
  const lines: string[] = [];
  let line = "";

  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > LINE_CHARS) {
      lines.push(line);

      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }

  if (line) {
    lines.push(line);
  }

  if (lines.length <= MAX_LINES) {
    return lines;
  }

  const kept = lines.slice(0, MAX_LINES);
  const last = kept[MAX_LINES - 1];

  kept[MAX_LINES - 1] = (last.length > LINE_CHARS - 1 ? last.slice(0, LINE_CHARS - 1) : last).trimEnd() + "…";

  return kept;
}

function github(path: string): Promise<Response> {
  const headers: Record<string, string> = { accept: "application/vnd.github+json" };
  const token = Deno.env.get("GITHUB_TOKEN");

  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  return fetch(`https://api.github.com/${path}`, { headers });
}

async function hasMergedPr(user: string, owner: string): Promise<boolean> {
  const query = encodeURIComponent(`is:pr is:merged author:${user} user:${owner}`);
  const res = await github(`search/issues?q=${query}&per_page=1`);

  if (!res.ok) {
    throw new Error(`searching ${user}'s merged PRs in ${owner}: GitHub API ${res.status} ${await res.text()}`);
  }

  const result: { total_count: number } = await res.json();

  return result.total_count > 0;
}

async function resolve(user: string, entry: CardConfig): Promise<Card> {
  const [owner, name] = entry.repo.includes("/") ? entry.repo.split("/", 2) : [user, entry.repo];
  const fullName = `${owner}/${name}`;
  const res = await github(`repos/${fullName}`);

  if (res.status === 404) {
    throw new Error(`${fullName}: not found (private repos are invisible to profile visitors)`);
  }

  if (!res.ok) {
    throw new Error(`${fullName}: GitHub API ${res.status} ${await res.text()}`);
  }

  const repo: { html_url: string; private: boolean; description: string | null; language: string | null } = await res
    .json();

  if (repo.private) {
    throw new Error(`${fullName}: private repo; profile visitors would get a 404`);
  }

  if (entry.contributor && !(await hasMergedPr(user, owner))) {
    throw new Error(`${fullName}: marked as contributor, but ${user} has no merged PR in any ${owner} repo`);
  }

  return {
    owner: owner === user ? null : owner,
    name,
    url: entry.url ?? repo.html_url,
    description: entry.description ?? repo.description ?? "",
    language: entry.language ?? repo.language,
    tag: entry.tag ?? null,
    contributor: entry.contributor ?? false,
  };
}

function renderCard(card: Card, index: number): string {
  const accent = index % 2 === 0 ? CYAN : PINK;
  const other = accent === CYAN ? PINK : CYAN;
  const lines = wrap(card.description);
  const desc = lines
    .map((l, i) => `<text x="24" y="${78 + i * 20}" font-size="13.5" fill="${MUTED}">${escapeXml(l)}</text>`)
    .join("");
  const language = card.language
    ? `<circle cx="30" cy="125" r="6" fill="${
      LANGUAGE_COLORS[card.language] ?? MUTED
    }" stroke="${FG}" stroke-opacity=".35"/>
    <text x="44" y="130" font-size="13" fill="${FG}">${escapeXml(card.language)}</text>`
    : "";
  let tag = "";

  if (card.tag) {
    const w = card.tag.length * 7 + 20;

    tag = `<rect x="${
      416 - w
    }" y="112" width="${w}" height="24" rx="12" fill="${accent}" fill-opacity=".1" stroke="${accent}" stroke-opacity=".6"/>
    <text x="${416 - w / 2}" y="128" font-size="12" text-anchor="middle" fill="${accent}">${
      escapeXml(card.tag)
    }</text>`;
  }

  let badge = "";

  if (card.contributor) {
    const w = 119;

    badge = `<rect x="${
      416 - w
    }" y="21" width="${w}" height="26" rx="13" fill="${accent}" fill-opacity=".14" stroke="${accent}"/>
    <path d="${MERGE_ICON}" transform="translate(${416 - w + 12} 26)" fill="${accent}"/>
    <text x="${416 - w + 34}" y="38.5" font-size="12.5" font-weight="600" fill="${accent}">contributor</text>`;
  }

  const fullName = card.owner ? `${card.owner}/${card.name}` : card.name;
  const title = card.owner
    ? `<tspan fill="${MUTED}" font-weight="400">${escapeXml(card.owner)}/</tspan>${escapeXml(card.name)}`
    : escapeXml(card.name);
  const label = escapeXml(
    `${fullName}${card.contributor ? " (contributor)" : ""}${card.description ? `: ${card.description}` : ""}`,
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="150" viewBox="0 0 440 150" role="img" aria-label="${label}">
  <defs>
    <linearGradient id="edge" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${accent}"/><stop offset="1" stop-color="${other}" stop-opacity=".35"/></linearGradient>
    <filter id="glow" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect x="1" y="1" width="438" height="148" rx="12" fill="${BG}" stroke="url(#edge)" stroke-width="1.5"/>
  <rect x="1" y="20" width="3" height="34" rx="1.5" fill="${accent}" filter="url(#glow)"/>
  <g font-family="${SANS}">
    <path d="${REPO_ICON}" transform="translate(24 30)" fill="${accent}"/>
    <text x="48" y="44" font-size="19" font-weight="600" fill="${FG}">${title}</text>
    ${badge}
    ${desc}
    ${language}
    ${tag}
  </g>
</svg>
`;
}

function renderReadmeBlock(groups: Group[]): string {
  return groups.map((group) => {
    const links = group.cards.map((c) =>
      `  <a href="${c.url}"><img src="profile/cards/${c.name}.svg" alt="${
        escapeXml(c.owner ? `${c.owner}/${c.name}` : c.name)
      }${c.contributor ? " (contributor)" : ""}" width="49%"></a>`
    );
    const heading = headingHtml(`profile/cards/headings/${group.slug}.svg`, group.title);

    return `${heading}\n\n<p align="center">\n${links.join("\n")}\n</p>`;
  }).join("\n\n");
}

const config: Config = JSON.parse(await Deno.readTextFile(CONFIG));
const groups: Group[] = await Promise.all(
  config.groups.map(async (group) => ({
    title: group.title,
    slug: slugify(group.title),
    icon: group.icon,
    cards: await Promise.all(group.cards.map((entry) => resolve(config.user, entry))),
  })),
);
// Accents alternate per group so every row pairs a cyan and a pink card.
const cardFiles = new Map(
  groups.flatMap((group) => group.cards.map((card, i) => [`${card.name}.svg`, renderCard(card, i)] as const)),
);
const headingFiles = new Map(
  await Promise.all(
    groups.map(async (group) => [`${group.slug}.svg`, await renderHeading(group.title, group.icon)] as const),
  ),
);

if (cardFiles.size !== groups.flatMap((group) => group.cards).length) {
  throw new Error("two cards share a repo name; profile/cards/<name>.svg would collide");
}

if (headingFiles.size !== groups.length) {
  throw new Error("two groups share a title; profile/cards/headings/<title>.svg would collide");
}

await syncSvgs(CARD_DIR, cardFiles);
await syncSvgs(HEADING_DIR, headingFiles);
await writeReadmeBlock("cards", renderReadmeBlock(groups));

console.log(groups.map((g) => `${g.title}: ${g.cards.map((c) => c.name).join(", ")}`).join("\n"));
