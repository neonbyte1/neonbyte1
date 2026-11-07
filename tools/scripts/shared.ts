/** Theme, paths, icon and README helpers shared by the profile asset generators. */

export const ROOT = new URL("../../", import.meta.url);
export const README = new URL("README.md", ROOT);
const ICON_DIR = new URL("tools/icons/", ROOT);

export const CYAN = "#2ef6ff";
export const PINK = "#ff2a6d";
export const BG = "#07080d";
export const FG = "#e6f1ff";
export const MUTED = "#8b95ab";
export const BORDER = "#1c2030";

export const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
export const MONO = "'JetBrains Mono','Fira Code',SFMono-Regular,Consolas,'Liberation Mono',Menlo,monospace";

export const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface Icon {
  /** From the icon's `<title>`; what screen readers announce. */
  label: string;
  /** `<path>` elements scaled to the requested size, unpositioned and unfilled. */
  svg: string;
}

/**
 * Loads tools/icons/<name>.svg: a square, single-color SVG with a `<title>`
 * (Simple Icons, Octicons and Phosphor fill icons fit as-is), scaled to `size` px.
 */
export async function loadIcon(name: string, size: number): Promise<Icon> {
  let source: string;

  try {
    source = await Deno.readTextFile(new URL(`${name}.svg`, ICON_DIR));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(`unknown icon "${name}": add tools/icons/${name}.svg`);
    }

    throw error;
  }

  const label = source.match(/<title>([^<]+)<\/title>/)?.[1];
  const viewBox = source.match(/viewBox="0 0 (\d+(?:\.\d+)?) \1"/)?.[1];
  const paths = [...source.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map((m) => m[1]);

  if (!label || !viewBox || paths.length === 0) {
    throw new Error(`tools/icons/${name}.svg needs a <title>, a square "0 0 N N" viewBox and at least one <path>`);
  }

  const scale = Number((size / Number(viewBox)).toFixed(4));

  return {
    label,
    svg: `<g transform="scale(${scale})">${paths.map((d) => `<path d="${d}"/>`).join("")}</g>`,
  };
}

/** Lowercase, dash-separated file/anchor-safe form of a title. */
export const slugify = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const HEADING_WIDTH = 900;
const HEADING_HEIGHT = 60;
const HEADING_FONT_SIZE = 20;
/** Extra space between title letters, in px. */
const HEADING_TRACKING = 1;
const HEADING_ICON = 24;
const HEADING_GAP = 14;
/** The dark plate behind icon + title keeps the neon readable on GitHub's light theme too. */
const PLATE_PADDING = 20;
const PLATE_HEIGHT = 42;

/**
 * Section heading banner: fading cyan/pink rules with glowing diamonds lead into a
 * dark plate with a neon edge; the icon (tools/icons/<icon>.svg) and title, cased as
 * written, sit on it in plain FG so the neon stays in the frame. The plate keeps the
 * light title readable on GitHub's light theme. `textLength` pins the title to the
 * computed width so the layout holds whatever monospace font renders it.
 */
export async function renderHeading(title: string, iconName: string): Promise<string> {
  const icon = await loadIcon(iconName, HEADING_ICON);
  const chars = [...title].length;
  const textWidth = chars * HEADING_FONT_SIZE * 0.6 + (chars - 1) * HEADING_TRACKING;
  const blockWidth = HEADING_ICON + HEADING_GAP + textWidth;
  const x0 = Math.round((HEADING_WIDTH - blockWidth) / 2);
  const x1 = Math.round(x0 + blockWidth);
  const textX = x0 + HEADING_ICON + HEADING_GAP;
  const plateX0 = x0 - PLATE_PADDING;
  const plateX1 = x1 + PLATE_PADDING;
  const cy = HEADING_HEIGHT / 2;
  const diamond = (cx: number, color: string) =>
    `<rect x="${cx - 3.5}" y="${
      cy - 3.5
    }" width="7" height="7" transform="rotate(45 ${cx} ${cy})" fill="${color}" filter="url(#glow)"/>`;
  const plate = `x="${plateX0}" y="${cy - PLATE_HEIGHT / 2}" width="${
    plateX1 - plateX0
  }" height="${PLATE_HEIGHT}" rx="${PLATE_HEIGHT / 2}"`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${HEADING_WIDTH}" height="${HEADING_HEIGHT}" viewBox="0 0 ${HEADING_WIDTH} ${HEADING_HEIGHT}" role="img" aria-label="${
    escapeXml(title)
  }">
  <defs>
    <linearGradient id="plate" gradientUnits="userSpaceOnUse" x1="${plateX0}" y1="0" x2="${plateX1}" y2="0"><stop offset="0" stop-color="${CYAN}"/><stop offset="1" stop-color="${PINK}"/></linearGradient>
    <linearGradient id="left" x1="0" x2="1"><stop offset="0" stop-color="${CYAN}" stop-opacity="0"/><stop offset="1" stop-color="${CYAN}"/></linearGradient>
    <linearGradient id="right" x1="0" x2="1"><stop offset="0" stop-color="${PINK}"/><stop offset="1" stop-color="${PINK}" stop-opacity="0"/></linearGradient>
    <filter id="glow" x="-20%" y="-80%" width="140%" height="260%"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="halo" x="-10%" y="-50%" width="120%" height="200%"><feGaussianBlur stdDeviation="4"/></filter>
  </defs>
  <rect x="20" y="${cy - 0.75}" width="${plateX0 - 24 - 20}" height="1.5" fill="url(#left)"/>
  ${diamond(plateX0 - 14, CYAN)}
  <rect ${plate} fill="none" stroke="url(#plate)" stroke-width="3" opacity=".55" filter="url(#halo)"/>
  <rect ${plate} fill="${BG}" stroke="url(#plate)" stroke-width="1.5"/>
  <g transform="translate(${x0} ${cy - HEADING_ICON / 2})" fill="${FG}">${icon.svg}</g>
  <text x="${textX}" y="${cy + 7}" textLength="${
    Number(textWidth.toFixed(1))
  }" lengthAdjust="spacing" font-family="${MONO}" font-size="${HEADING_FONT_SIZE}" font-weight="700" fill="${FG}">${
    escapeXml(title)
  }</text>
  ${diamond(plateX1 + 14, PINK)}
  <rect x="${plateX1 + 24}" y="${cy - 0.75}" width="${
    HEADING_WIDTH - 20 - (plateX1 + 24)
  }" height="1.5" fill="url(#right)"/>
</svg>
`;
}

/**
 * README markup for a heading banner. An `<h3>` keeps it a real heading for screen
 * readers and the outline without the gray rule GitHub draws under `<h2>`.
 */
export const headingHtml = (src: string, title: string) =>
  `<h3 align="center"><img src="${src}" alt="${escapeXml(title)}" width="100%"></h3>`;

/** Writes `files` (name → SVG) into `dir` and deletes any other SVG file directly in it. */
export async function syncSvgs(dir: URL, files: Map<string, string>): Promise<void> {
  await Deno.mkdir(dir, { recursive: true });

  for await (const file of Deno.readDir(dir)) {
    if (file.isFile && file.name.endsWith(".svg") && !files.has(file.name)) {
      await Deno.remove(new URL(file.name, dir));
      console.log(`removed ${new URL(file.name, dir).pathname.slice(ROOT.pathname.length)}`);
    }
  }

  await Promise.all([...files].map(([name, svg]) => Deno.writeTextFile(new URL(name, dir), svg)));
}

/** Replaces everything between `<!-- name:start -->` and `<!-- name:end -->` in README.md. */
export async function writeReadmeBlock(name: string, content: string): Promise<void> {
  const startMarker = `<!-- ${name}:start -->`;
  const endMarker = `<!-- ${name}:end -->`;
  const readme = await Deno.readTextFile(README);
  const start = readme.indexOf(startMarker);
  const end = readme.indexOf(endMarker);

  if (start < 0 || end < start) {
    throw new Error(`README.md is missing the ${startMarker} … ${endMarker} markers`);
  }

  await Deno.writeTextFile(
    README,
    `${readme.slice(0, start)}${startMarker}\n${content}\n${readme.slice(end)}`,
  );
}
