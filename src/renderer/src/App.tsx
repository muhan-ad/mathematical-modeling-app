import { Button } from '@/components/ui/button'
import { GitBranch, Zap, FileText } from 'lucide-react'

// Fallback used when running outside Electron (e.g. Playwright, plain browser).
// In the real Electron window, preload injects window.app.
const fallbackApp = {
  platform: 'browser',
  versions: { electron: 'n/a', chrome: 'n/a', node: 'n/a' }
}

export default function App() {
  const app = (typeof window !== 'undefined' && window.app) || fallbackApp

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="container mx-auto max-w-4xl py-16 px-6">
        {/* Hero */}
        <header className="mb-12">
          <h1 className="text-4xl font-semibold tracking-tight">Windows App Maker</h1>
          <p className="mt-2 text-muted-foreground text-lg">
            Electron + Vite + React + TypeScript + Tailwind + shadcn/ui
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button>
              <Zap className="size-4" /> 开始
            </Button>
            <Button variant="outline">
              <GitBranch className="size-4" /> 源码
            </Button>
            <Button variant="ghost">
              <FileText className="size-4" /> 文档
            </Button>
          </div>
        </header>

        {/* Runtime info card */}
        <section className="rounded-lg border bg-card p-6 mb-6">
          <h2 className="text-base font-semibold text-primary mb-4">运行环境</h2>
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between">
              <span className="text-muted-foreground">平台</span>
              <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">{app.platform}</code>
            </li>
            <li className="flex justify-between">
              <span className="text-muted-foreground">Electron</span>
              <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">{app.versions.electron}</code>
            </li>
            <li className="flex justify-between">
              <span className="text-muted-foreground">Chromium</span>
              <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">{app.versions.chrome}</code>
            </li>
            <li className="flex justify-between">
              <span className="text-muted-foreground">Node.js</span>
              <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">{app.versions.node}</code>
            </li>
          </ul>
        </section>

        {/* Hint card */}
        <section className="rounded-lg border bg-card p-6">
          <h2 className="text-base font-semibold text-primary mb-2">下一步</h2>
          <p className="text-sm text-muted-foreground leading-6">
            修改 <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">src/renderer/src/App.tsx</code>
            或 <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">src/main/index.ts</code>
            后，Vite HMR 会自动刷新。继续用 <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">npx shadcn@latest add &lt;component&gt;</code>
            添加更多组件。
          </p>
        </section>
      </main>
    </div>
  )
}
