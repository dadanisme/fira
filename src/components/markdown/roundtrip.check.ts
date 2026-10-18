/**
 * Markdown round-trip check for the editor schema. Run: `npx tsx src/components/markdown/roundtrip.check.ts`.
 * For each sample: parse → serialize must be semantically lossless (same document
 * when parsed again) and stable (serializing twice gives the same Markdown).
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
  'line one\nline two',
  '',
];

let failed = 0;
for (const input of samples) {
  const doc = md.parse(input);
  const out = md.serialize(doc);
  const lossless = JSON.stringify(md.parse(out)) === JSON.stringify(doc);
  const stable = md.serialize(md.parse(out)) === out;
  const status = !lossless ? 'LOSSY' : !stable ? 'UNSTABLE' : out === input ? 'exact' : 'normalized';
  if (!lossless || !stable) failed++;
  console.log(`${status.padEnd(10)} ${JSON.stringify(input).slice(0, 70)}`);
  if (status !== 'exact') console.log(`           → ${JSON.stringify(out).slice(0, 140)}`);
}
if (failed) throw new Error(`${failed} sample(s) failed`);
