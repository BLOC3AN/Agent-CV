'use client'

import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

function MermaidDiagram({ source }: { source: string }) {
  return <div data-mermaid-source={source} className="chat-mermaid my-3 min-h-8 overflow-x-auto rounded-md border border-border p-3" />
}

/** Renderer an toàn cho nội dung trợ lý: GFM + LaTeX + Mermaid. */
export function RichText({ content }: { content: string }) {
  return (
    <div className="chat-rich-text text-sm leading-6">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          code({ className, children, ...props }) {
            const language = /language-(\w+)/.exec(className ?? '')?.[1]
            const source = String(children).replace(/\n$/, '')
            if (language === 'mermaid') return <MermaidDiagram source={source} />
            return (
              <code className="rounded bg-canvas px-1 py-0.5 text-[0.9em]" {...props}>
                {children}
              </code>
            )
          },
          pre({ children }) {
            return <pre className="my-2 overflow-x-auto rounded-md bg-canvas p-3 text-xs">{children}</pre>
          },
          a({ children, href, ...props }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="text-brand-ink underline underline-offset-2"
                {...props}
              >
                {children}
              </a>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
