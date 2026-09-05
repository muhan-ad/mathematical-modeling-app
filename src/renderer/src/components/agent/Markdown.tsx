import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'

/**
 * 把模型常输出的 LaTeX 定界符 \( \) \[ \] 归一化为 $ / $$（代码块内不处理）。
 */
function normalizeMathDelimiters(md: string): string {
  const parts = md.split(/(```[\s\S]*?```|`[^`\n]*`)/g)
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part // 代码块/行内代码原样保留
      return part
        .replace(/\\\[\s*\n?([\s\S]*?)\n?\s*\\\]/g, (_, tex) => `$$${tex}$$`)
        .replace(/\\\(([\s\S]*?)\\\)/g, (_, tex) => `$${tex}$`)
    })
    .join('')
}

/**
 * 轻量 Markdown 渲染（对话流用）：标题/列表/加粗/代码块/表格/数学公式（KaTeX），
 * 样式贴合应用现有 tailwind 色板。
 */
export function Markdown({ content }: { content: string }) {
  return (
    <div className="text-sm leading-7 break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [
            rehypeKatex,
            { throwOnError: false, errorColor: 'hsl(0 72% 51%)', output: 'htmlAndMathml' }
          ]
        ]}
        components={{
          h1: (p) => <h1 className="text-lg font-semibold mt-4 mb-2 first:mt-0" {...p} />,          h2: (p) => <h2 className="text-base font-semibold mt-4 mb-2 first:mt-0" {...p} />,
          h3: (p) => <h3 className="text-sm font-semibold mt-3 mb-1.5 first:mt-0" {...p} />,
          p: (p) => <p className="my-1.5 first:mt-0 last:mb-0" {...p} />,
          ul: (p) => <ul className="my-1.5 pl-5 list-disc space-y-0.5" {...p} />,
          ol: (p) => <ol className="my-1.5 pl-5 list-decimal space-y-0.5" {...p} />,
          li: (p) => <li className="leading-6" {...p} />,
          strong: (p) => <strong className="font-semibold text-foreground" {...p} />,
          em: (p) => <em className="italic" {...p} />,
          a: (p) => (
            <a className="text-primary underline underline-offset-2 break-all" target="_blank" rel="noreferrer" {...p} />
          ),
          blockquote: (p) => (
            <blockquote className="my-2 pl-3 border-l-2 border-border text-muted-foreground" {...p} />
          ),
          hr: () => <hr className="my-3 border-border" />,
          code: ({ className, children, ...rest }) => {
            const isBlock = /language-/.test(className ?? '')
            if (isBlock) {
              return (
                <code className="block font-mono text-xs leading-5 bg-muted/60 rounded-md p-3 overflow-x-auto" {...rest}>
                  {children}
                </code>
              )
            }
            return (
              <code className="font-mono text-xs bg-muted/60 rounded px-1 py-0.5" {...rest}>
                {children}
              </code>
            )
          },
          pre: (p) => <pre className="my-2" {...p} />,
          table: (p) => (
            <div className="my-2 overflow-x-auto">
              <table className="text-xs border-collapse" {...p} />
            </div>
          ),
          th: (p) => <th className="border border-border px-2 py-1 bg-muted/40 font-medium text-left" {...p} />,
          td: (p) => <td className="border border-border px-2 py-1" {...p} />
        }}
      >
        {normalizeMathDelimiters(content)}
      </ReactMarkdown>
    </div>
  )
}
