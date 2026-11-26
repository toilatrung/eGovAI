import { Children, Fragment, isValidElement, cloneElement, type ReactNode } from 'react'
import type { Components } from 'react-markdown'

const BR_RE = /<br\s*\/?>/gi

/** Đổi chuỗi "<br>" trong nội dung thành ngắt dòng thật (ô bảng Quốc hiệu, Nơi nhận…). */
export function withLineBreaks(children: ReactNode): ReactNode {
  return Children.map(children, (child, i) => {
    if (typeof child === 'string') {
      const text = child.replace(/&nbsp;/gi, ' ')
      if (!BR_RE.test(text)) return text
      BR_RE.lastIndex = 0
      const parts = text.split(BR_RE)
      return (
        <Fragment key={i}>
          {parts.map((p, j) => (
            <Fragment key={j}>
              {j > 0 && <br />}
              {p}
            </Fragment>
          ))}
        </Fragment>
      )
    }
    if (isValidElement<{ children?: ReactNode }>(child) && child.props.children !== undefined) {
      return cloneElement(child, undefined, withLineBreaks(child.props.children))
    }
    return child
  })
}

/** Thành phần ReactMarkdown hiểu `<br>` / `&nbsp;` mà mô hình hay dùng trong bảng. */
export const breakAwareComponents: Components = {
  p: ({ children }) => <p>{withLineBreaks(children)}</p>,
  li: ({ children }) => <li>{withLineBreaks(children)}</li>,
  td: ({ children, style }) => <td style={style}>{withLineBreaks(children)}</td>,
  th: ({ children, style }) => <th style={style}>{withLineBreaks(children)}</th>
}

/** Bỏ ký hiệu định dạng để sao chép ra văn bản thường (cán bộ không dùng Markdown). */
export function markdownToPlainText(md: string): string {
  return md
    .split(/\r?\n/)
    .filter((line) => !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line))
    .filter((line) => !/^\s*([-*_])\1{2,}\s*$/.test(line))
    .map((line) => {
      let l = line
      if (/^\s*\|/.test(l)) {
        l = l
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim())
          .join('\t')
      }
      return l
        .replace(/^#{1,6}\s+/, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/&nbsp;/gi, ' ')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
        .replace(/`([^`]+)`/g, '$1')
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
