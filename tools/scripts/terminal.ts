/**
 * Generates the animated terminal (profile/terminal.svg) from profile/terminal.json.
 *
 *   deno task terminal
 *
 * Each session entry types `command` character by character after the prompt,
 * then reveals its `output` lines, indented below the prompt. An output line is
 *   - a string or a list of segments; a segment is a string (default color) or
 *     `{ "text", "color" }` with color one of fg, muted, cyan, pink;
 *   - or `{ "icon", "text", "color" }`: an icon from tools/icons/<icon>.svg
 *     followed by `text`; `color` tints the icon and plain-string text.
 * Spaces are preserved as typed. The session ends on a prompt with a blinking
 * cursor. Also rewrites the README block between <!-- terminal:start --> and
 * <!-- terminal:end --> so the image alt text matches the session.
 *
 * Icons are 24×24 single-color SVGs whose <title> names them for screen readers
 * (Simple Icons, https://simpleicons.org, fits as-is).
 */

import {
  BG,
  BORDER,
  CYAN,
  escapeXml,
  FG,
  type Icon,
  loadIcon,
  MONO,
  MUTED,
  PINK,
  ROOT,
  writeReadmeBlock,
} from "./shared.ts";

const CONFIG = new URL("profile/terminal.json", ROOT);
const OUT = new URL("profile/terminal.svg", ROOT);

const COLORS = { fg: FG, muted: MUTED, cyan: CYAN, pink: PINK } as const;

const WIDTH = 900;
const FONT_SIZE = 15;
const LINE_HEIGHT = 26;
const TEXT_X = 28;
const FIRST_BASELINE = 78;
/** Output lines sit ≈2 monospace columns right of the prompt. */
const OUTPUT_INDENT = 18;
const ICON_SIZE = 16;
const ICON_GAP = 10;
/** Distance from the text baseline up to the icon's top edge, centering it on the glyphs. */
const ICON_RISE = 13;

/** Animation timeline, in seconds. */
const FIRST_PROMPT_AT = 0.3;
const TYPING_DELAY = 0.35;
const PER_CHAR = 0.08;
const OUTPUT_DELAY = 0.3;
const OUTPUT_STAGGER = 0.15;
const NEXT_PROMPT_DELAY = 0.6;

type ColorName = keyof typeof COLORS;
type Segment = string | { text: string; color?: ColorName };
type Text = string | Segment[];
type OutputLine = Text | { icon: string; text: Text; color?: ColorName };

interface Config {
  user: string;
  host: string;
  cwd: string;
  session: { command: string; output?: OutputLine[] }[];
}

interface Line {
  icon?: Icon & { color: string };
  segments: { text: string; color: string }[];
}

interface Row {
  at: number;
  x: number;
  icon?: Line["icon"];
  body: string;
}

const seconds = (t: number) => `${Number(t.toFixed(2))}s`;

/** Fades the parent element in at `at` and keeps it visible. */
const reveal = (at: number) => `<set attributeName="opacity" to="1" begin="${seconds(at)}" fill="freeze"/>`;

/** NBSP keeps runs of spaces from collapsing inside the rendered `<img>`. */
const preserveSpaces = (text: string) => escapeXml(text).replace(/ /g, "\u00a0");

function color(name: ColorName | undefined): string {
  const value = COLORS[name ?? "fg"];

  if (!value) {
    throw new Error(`unknown color "${name}" (expected one of ${Object.keys(COLORS).join(", ")})`);
  }

  return value;
}

function segments(text: Text, fallback: string): Line["segments"] {
  const list = typeof text === "string" ? [text] : text;

  return list.map((s) =>
    typeof s === "string" ? { text: s, color: fallback } : { text: s.text, color: color(s.color) }
  );
}

async function normalize(line: OutputLine): Promise<Line> {
  if (typeof line === "string" || Array.isArray(line)) {
    return { segments: segments(line, FG) };
  }

  const tint = color(line.color);

  return { icon: { ...await loadIcon(line.icon, ICON_SIZE), color: tint }, segments: segments(line.text, tint) };
}

function prompt(config: Config): string {
  return `<tspan fill="${PINK}" filter="url(#glow)">${escapeXml(config.user)}</tspan>` +
    `<tspan fill="${MUTED}">@</tspan>` +
    `<tspan fill="${CYAN}" filter="url(#glow)">${escapeXml(config.host)}</tspan>` +
    `<tspan fill="${MUTED}">${preserveSpaces(` ${config.cwd} $ `)}</tspan>`;
}

function buildRows(config: Config, session: { command: string; output: Line[] }[]): Row[] {
  const rows: Row[] = [];
  let at = FIRST_PROMPT_AT;

  for (const { command, output } of session) {
    const typingStart = at + TYPING_DELAY;
    const typed = [...command].map((ch, i) =>
      `<tspan fill="${FG}" opacity="0">${reveal(typingStart + i * PER_CHAR)}${preserveSpaces(ch)}</tspan>`
    ).join("");

    rows.push({ at, x: TEXT_X, body: `${prompt(config)}${typed}` });

    at = typingStart + [...command].length * PER_CHAR + OUTPUT_DELAY;

    for (const line of output) {
      const body = line.segments.map((s) => `<tspan fill="${s.color}">${preserveSpaces(s.text)}</tspan>`).join("");
      const x = TEXT_X + OUTPUT_INDENT + (line.icon ? ICON_SIZE + ICON_GAP : 0);

      rows.push({ at, x, icon: line.icon, body });

      at += OUTPUT_STAGGER;
    }

    at += NEXT_PROMPT_DELAY - (output.length > 0 ? OUTPUT_STAGGER : 0);
  }

  const cursor = `<tspan fill="${CYAN}" opacity="0">█<set attributeName="opacity" to="1" begin="${seconds(at)}"/>` +
    `<animate attributeName="opacity" values="1;1;0;0" keyTimes="0;0.5;0.5;1" dur="1s" begin="${
      seconds(at)
    }" repeatCount="indefinite"/></tspan>`;

  rows.push({ at, x: TEXT_X, body: `${prompt(config)}${cursor}` });

  return rows;
}

/**
 * Plain-text transcript of the session, used for aria-label and README alt text.
 * Icons are read as their label, symbol glyphs (bullets like ▸) are dropped so
 * screen readers don't spell them out, and the `$` prompt is omitted.
 */
function transcript(session: { command: string; output: Line[] }[]): string {
  return session.map(({ command, output }) => {
    const lines = output
      .map((line) => {
        const text = line.segments.map((s) => s.text).join("").replace(/\p{So}/gu, "").replace(/\s+/g, " ").trim();

        return line.icon ? `${line.icon.label}: ${text}` : text;
      })
      .filter(Boolean);

    return lines.length > 0 ? `${command}: ${lines.join("; ")}.` : `${command}.`;
  }).join(" ");
}

function renderRow(row: Row, i: number): string {
  const y = FIRST_BASELINE + i * LINE_HEIGHT;
  const icon = row.icon
    ? `<g transform="translate(${TEXT_X + OUTPUT_INDENT} ${
      y - ICON_RISE
    })" fill="${row.icon.color}" filter="url(#glow)">${row.icon.svg}</g>`
    : "";

  return `    <g opacity="0">${reveal(row.at)}${icon}<text x="${row.x}" y="${y}">${row.body}</text></g>`;
}

function renderSvg(config: Config, rows: Row[], label: string): string {
  const height = FIRST_BASELINE + LINE_HEIGHT * rows.length - 4;
  const title = escapeXml(`${config.user}@${config.host}: ${config.cwd}`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="${
    escapeXml(label)
  }">
  <defs>
    <linearGradient id="edge" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${CYAN}"/><stop offset="1" stop-color="${PINK}"/></linearGradient>
    <filter id="glow" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect x="1" y="1" width="${WIDTH - 2}" height="${
    height - 2
  }" rx="14" fill="${BG}" stroke="url(#edge)" stroke-width="1.5"/>
  <path d="M1 44 H${WIDTH - 1}" stroke="${BORDER}"/>
  <circle cx="26" cy="23" r="6" fill="#ff5f57"/><circle cx="46" cy="23" r="6" fill="#febc2e"/><circle cx="66" cy="23" r="6" fill="#28c840"/>
  <text x="${
    WIDTH / 2
  }" y="28" text-anchor="middle" font-family="${MONO}" font-size="13" fill="${MUTED}">${title}</text>
  <g font-family="${MONO}" font-size="${FONT_SIZE}">
${rows.map(renderRow).join("\n")}
  </g>
</svg>
`;
}

const config: Config = JSON.parse(await Deno.readTextFile(CONFIG));
const session = await Promise.all(
  config.session.map(async ({ command, output = [] }) => ({
    command,
    output: await Promise.all(output.map(normalize)),
  })),
);
const label = transcript(session);

await Deno.writeTextFile(OUT, renderSvg(config, buildRows(config, session), label));

// Markdown math renderers (e.g. Markdown Preview Enhanced) parse `$…$` even inside HTML attributes;
// an entity keeps any `$` from the session text from opening a KaTeX span.
const alt = escapeXml(label).replace(/\$/g, "&#36;");

await writeReadmeBlock(
  "terminal",
  `<p align="center">\n  <img src="profile/terminal.svg" alt="${alt}" width="100%">\n</p>`,
);

console.log(`generated profile/terminal.svg (${config.session.length} commands)`);
