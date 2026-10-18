import { cx } from '../../lib/cx';
import type { MarkdownViewProps } from '../MarkdownEditor';

// Placeholder: the docs feature replaces this with rendered Markdown.
export default function MarkdownViewImpl({ value, className }: MarkdownViewProps) {
  return <div className={cx('whitespace-pre-wrap', className)}>{value}</div>;
}
