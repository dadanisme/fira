import { memo, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { JSONContent } from '@tiptap/core';
import { getSchema } from '@tiptap/core';
import { MarkdownManager } from '@tiptap/markdown';
import { cx } from '../../lib/cx';
import type { MarkdownViewProps } from '../MarkdownEditor';
import { cardHref, cardKeyMatches } from './cardLinks';
import { schemaExtensions } from './schema';
import './markdown.css';

/**
 * Read-only Markdown: parsed with the editor's own Markdown manager (same schema,
 * so it renders exactly what the editor would) into JSON, then rendered as plain
 * React elements. No editor instance, no innerHTML; parse results are cached.
 */

let manager: MarkdownManager | null = null;
function parse(markdown: string): JSONContent {
  if (!manager) {
    const extensions = schemaExtensions();
    getSchema(extensions);
    manager = new MarkdownManager({ extensions });
  }
  const hit = cache.get(markdown);
  if (hit) {
    cache.delete(markdown);
    cache.set(markdown, hit);
    return hit;
  }
  const doc = manager.parse(markdown);
  cache.set(markdown, doc);
  if (cache.size > 300) cache.delete(cache.keys().next().value as string);
  return doc;
}
const cache = new Map<string, JSONContent>();

const SAFE_URL = /^(https?:|mailto:|tel:|\/|#)/i;
const safeUrl = (url: unknown) => (typeof url === 'string' && SAFE_URL.test(url.trim()) ? url : undefined);

function renderText(text: string, inCode: boolean): ReactNode {
  if (inCode) return text;
  const matches = cardKeyMatches(text);
  if (matches.length === 0) return text;
  const out: ReactNode[] = [];
  let last = 0;
  for (const [start, end, key] of matches) {
    if (start > last) out.push(text.slice(last, start));
    out.push(
      <Link key={start} to={cardHref(key)} className="md-card-chip">
        {key}
      </Link>,
    );
    last = end;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function renderInline(node: JSONContent, key: number, inCode = false): ReactNode {
  if (node.type === 'hardBreak') return <br key={key} />;
  if (node.type === 'image') return renderNode(node, key);
  if (node.type !== 'text') return null;
  const marks = node.marks ?? [];
  const code = inCode || marks.some((m) => m.type === 'code');
  const linked = marks.some((m) => m.type === 'link');
  let el: ReactNode = renderText(node.text ?? '', code || linked);
  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':
        el = <strong>{el}</strong>;
        break;
      case 'italic':
        el = <em>{el}</em>;
        break;
      case 'strike':
        el = <s>{el}</s>;
        break;
      case 'code':
        el = <code>{el}</code>;
        break;
      case 'link': {
        const href = safeUrl(mark.attrs?.href);
        el = (
          <a href={href} target="_blank" rel="noopener noreferrer nofollow">
            {el}
          </a>
        );
        break;
      }
    }
  }
  return <span key={key}>{el}</span>;
}

function children(node: JSONContent, inCode = false): ReactNode {
  return node.content?.map((child, i) => (child.type === 'text' || child.type === 'hardBreak' ? renderInline(child, i, inCode) : renderNode(child, i)));
}

function renderNode(node: JSONContent, key: number): ReactNode {
  const attrs = node.attrs ?? {};
  switch (node.type) {
    case 'paragraph':
      return <p key={key}>{children(node)}</p>;
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(attrs.level) || 1));
      const H = `h${level}` as 'h1';
      return <H key={key}>{children(node)}</H>;
    }
    case 'bulletList':
      return <ul key={key}>{children(node)}</ul>;
    case 'orderedList':
      return (
        <ol key={key} start={attrs.start && attrs.start !== 1 ? Number(attrs.start) : undefined}>
          {children(node)}
        </ol>
      );
    case 'listItem':
      return <li key={key}>{children(node)}</li>;
    case 'taskList':
      return (
        <ul key={key} data-type="taskList">
          {children(node)}
        </ul>
      );
    case 'taskItem':
      return (
        <li key={key} data-type="taskItem" data-checked={attrs.checked ? 'true' : 'false'}>
          <label>
            <input type="checkbox" checked={!!attrs.checked} readOnly tabIndex={-1} />
          </label>
          <div>{children(node)}</div>
        </li>
      );
    case 'blockquote':
      return <blockquote key={key}>{children(node)}</blockquote>;
    case 'codeBlock':
      return (
        <pre key={key}>
          <code className={attrs.language ? `language-${attrs.language}` : undefined}>{children(node, true)}</code>
        </pre>
      );
    case 'horizontalRule':
      return <hr key={key} />;
    case 'image': {
      const src = safeUrl(attrs.src);
      return src ? <img key={key} src={src} alt={attrs.alt ?? ''} title={attrs.title ?? undefined} loading="lazy" /> : null;
    }
    case 'table':
      return (
        <div key={key} className="tableWrapper">
          <table>
            <tbody>{children(node)}</tbody>
          </table>
        </div>
      );
    case 'tableRow':
      return <tr key={key}>{children(node)}</tr>;
    case 'tableHeader':
    case 'tableCell': {
      const Cell = node.type === 'tableHeader' ? 'th' : 'td';
      return (
        <Cell key={key} colSpan={attrs.colspan > 1 ? attrs.colspan : undefined} rowSpan={attrs.rowspan > 1 ? attrs.rowspan : undefined}>
          {children(node)}
        </Cell>
      );
    }
    case 'text':
    case 'hardBreak':
      return renderInline(node, key);
    default:
      return node.content ? <div key={key}>{children(node)}</div> : null;
  }
}

function MarkdownViewImpl({ value, variant = 'compact', className }: MarkdownViewProps) {
  const doc = parse(value);
  return <div className={cx('md', variant === 'page' ? 'md-page' : 'md-compact', className)}>{children(doc)}</div>;
}

export default memo(MarkdownViewImpl);
