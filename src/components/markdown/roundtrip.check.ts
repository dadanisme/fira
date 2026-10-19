/**
 * Markdown round-trip check for the editor schema. Run: `npx tsx src/components/markdown/roundtrip.check.ts`.
 * For each sample: parse → serialize must be semantically lossless (same document
 * when parsed again) and stable (serializing twice gives the same Markdown).
 * `exactSamples` must come back byte-for-byte; `paragraphTexts` must stay paragraphs.
 */
import { getSchema } from '@tiptap/core';
import { MarkdownManager } from '@tiptap/markdown';
import { schemaExtensions } from './schema';

const extensions = schemaExtensions();
getSchema(extensions);
const md = new MarkdownManager({ extensions });

const samples: string[] = [
  '# Heading 1\n\n## Heading 2\n\n### Heading 3',
  'Some **bold**, *italic*, ~~strike~~, `code` and a [link](https://example.com/a?b=c).',
  'Mentions NI-12 and WEB2-3 stay plain text.',
  '- one\n- two\n  - nested\n\n1. first\n2. second',
  '- [ ] todo\n- [x] done\n  - [ ] nested todo',
  '> quote line\n>\n> second paragraph',
  '```ts\nconst x = 1;\n\nconst y = 2;\n```',
  'above\n\n---\n\nbelow',
  '| a | b |\n| --- | --- |\n| 1 | **2** |',
  '![alt text](https://firebasestorage.googleapis.com/v0/b/x/o/pages%2Fabc%2Fimg.png?alt=media&token=1)',
  'Literal \\*stars\\* and \\# hash',
  // A needless escape is dropped, but the text stays a paragraph.
  'Ya\\. satu',
  '1) one\n2) two',
  'line one\nline two',
  '',
];

// Page attachment URLs (`POST /pages/{id}/attachments`, editor uploads) must survive an
// edit in the app byte-for-byte: no re-encoding of `%2F`, no escaping of `&`, no `<…>`.
const tokenUrl = (path: string) =>
  `https://firebasestorage.googleapis.com/v0/b/fira-app.appspot.com/o/${path}?alt=media&token=3f6c2b1e-8d4a-4c7e-9b2f-5a1d0e7c4b93`;
const exactSamples: string[] = [
  `![Slide 1](${tokenUrl('pages%2FPgWk3Nq7Hd1Lm5Rx9Zc2%2FPa4Hx8Lq2Vn6Rt0Kz3Mw%2Fslide-01-v2.png')})`,
  `## Visual\n\n![Slide 1](${tokenUrl('pages%2Fp1%2Fa1%2Fslide-01.png')})\n\n![Slide 2](${tokenUrl('pages%2Fp1%2Fa2%2Fslide-02.png')})\n\nAfter the gallery.`,
  `![](${tokenUrl('pages%2Fp1%2Fa3%2Fslide%20%281%29%20final.png')})`,
  `![Slide 1](http://127.0.0.1:9199/v0/b/demo-fira.appspot.com/o/pages%2Fp1%2Fa1%2Fslide.png?alt=media&token=3f6c2b1e-8d4a-4c7e-9b2f-5a1d0e7c4b93)`,
];
exactSamples.push(
  // Only digit markers start an ordered list (GFM): these are paragraphs.
  'Ya. satu\n\nIV. empat\n\nA. pilihan',
  'Di. sini contoh.',
  'Layak. dua',
  'i. kecil\n\nb. huruf',
  '1. one\n2. two',
  '3. three\n4. four',
  '1. **bold** and `code`\n2. [link](https://example.com)',
  '1. a\n2. b\nYa. lazy continuation',
  '- bullet\n  1. nested one\n  2. nested two\n- after',
  '- [ ] todo\n- [x] done\n  1. nested step',
  // Paragraphs whose text starts like a block are escaped so they stay paragraphs.
  '1\\. not a list',
  '12\\) not a list',
  '\\# not a heading',
  '\\- not a bullet',
  '\\+ not a bullet',
  'line one\n2\\. not a list\n\\- not a bullet',
  '- 1\\. item text',
);
samples.push(...exactSamples);

let failed = 0;
for (const input of samples) {
  const doc = md.parse(input);
  const out = md.serialize(doc);
  const lossless = JSON.stringify(md.parse(out)) === JSON.stringify(doc);
  const stable = md.serialize(md.parse(out)) === out;
  const status = !lossless ? 'LOSSY' : !stable ? 'UNSTABLE' : out === input ? 'exact' : 'normalized';
  if (!lossless || !stable || (exactSamples.includes(input) && out !== input)) failed++;
  console.log(`${status.padEnd(10)} ${JSON.stringify(input).slice(0, 70)}`);
  if (status !== 'exact') console.log(`           → ${JSON.stringify(out).slice(0, 140)}`);
}
// Paragraph text that looks like block syntax must serialize so it reloads as a paragraph.
const paragraphTexts = ['1. one', '12) twelve', '# hash', '- dash', '+ plus', '> quote', '* star', '---', '  3. indented', 'a\n1. b', 'Ya. satu', 'IV. empat'];
for (const text of paragraphTexts) {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
  const out = md.serialize(doc);
  const back = md.parse(out);
  const ok = JSON.stringify(back) === JSON.stringify(doc) && md.serialize(back) === out;
  if (!ok) failed++;
  console.log(`${(ok ? 'paragraph' : 'BROKEN').padEnd(10)} ${JSON.stringify(text)} → ${JSON.stringify(out)}`);
}
if (failed) throw new Error(`${failed} sample(s) failed`);
