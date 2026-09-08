import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import mjml2html from 'mjml';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(repoRoot, 'src');

/**
 * MJML's document shell still carries three Internet Explorer declarations:
 * the `IE=edge` compatibility meta, `-ms-text-size-adjust` (IE Mobile / Windows
 * Phone) and `-ms-interpolation-mode` (IE 7-8 image scaling). IE was retired in
 * June 2022 and no mail client renders with its engine any more, so they are
 * stripped from the output here.
 *
 * Each pattern is asserted: if MJML ever changes its skeleton, the build fails
 * loudly instead of quietly shipping the cruft again.
 *
 * The `<!--[if mso | IE]>` ghost tables in the body are deliberately left alone.
 * Outlook enters those blocks on the `mso` term, so the `IE` half is redundant —
 * but rewriting 1,200+ generated conditionals to save ~6 KB is not a trade worth
 * making on a deliverable that can't be regression-tested in Outlook here.
 */
const DEAD_IE = [
  [
    '<!--[if !mso]><!-->\n    <meta http-equiv="X-UA-Compatible" content="IE=edge">\n    <!--<![endif]-->\n    ',
    '',
  ],
  [
    '-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;',
    '-webkit-text-size-adjust:100%;',
  ],
  [
    'text-decoration:none;-ms-interpolation-mode:bicubic;',
    'text-decoration:none;',
  ],
];

function stripDeadIE(html, file) {
  for (const [needle, replacement] of DEAD_IE) {
    if (!html.includes(needle)) {
      throw new Error(
        `${file}: expected IE-era pattern missing — MJML's skeleton has changed, ` +
          `re-check scripts/build.mjs:\n  ${needle.trim().split('\n')[0]}`,
      );
    }
    html = html.replaceAll(needle, replacement);
  }
  return html;
}

export async function buildOne(file) {
  const id = basename(file, '.mjml');
  const inputPath = join(srcDir, file);
  const outputDir = join(repoRoot, id);
  const outputPath = join(outputDir, 'index.html');

  const source = readFileSync(inputPath, 'utf8');
  const { html: rawHtml, errors } = await mjml2html(source, {
    filePath: inputPath,
    validationLevel: 'soft',
    keepComments: false,
  });

  for (const e of errors ?? []) {
    console.error(`  ! ${e.formattedMessage ?? e.message}`);
  }

  const html = stripDeadIE(rawHtml, file);

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputPath, html);
  console.log(`  ${file} -> ${id}/index.html`);
  return errors?.length ?? 0;
}

export async function buildAll() {
  const files = readdirSync(srcDir)
    .filter((f) => /^\d+\.mjml$/.test(f))
    .sort((a, b) => parseInt(a) - parseInt(b));

  console.log(`Building ${files.length} template${files.length === 1 ? '' : 's'}...`);
  let errors = 0;
  for (const file of files) errors += await buildOne(file);
  console.log(errors ? `Done with ${errors} warning(s).` : 'Done.');
  return errors;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  await buildAll();
}
