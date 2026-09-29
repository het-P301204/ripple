import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ErrorState } from '@/components/ui/States'
import { Button } from '@/components/ui/Button'

interface Props {
  children: ReactNode
  /** When any of these change (e.g. `[pathname]`), a caught error is cleared so navigating away recovers. */
  resetKeys?: ReadonlyArray<unknown>
  /** `app` = outermost boundary (renders a full-screen state, must not depend on router/store context). */
  scope?: 'app' | 'page'
}
interface State { failed: boolean }

const changed = (a: ReadonlyArray<unknown> = [], b: ReadonlyArray<unknown> = []) =>
  a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]))

/**
 * Catches render/lifecycle errors (including failed lazy-chunk imports) and shows a friendly ErrorState. The error
 * message and stack are never rendered - only logged to the console for developers.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State { return { failed: true } }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[ripple] render error', error, info.componentStack)
  }

  componentDidUpdate(prev: Props) {
    if (this.state.failed && changed(prev.resetKeys, this.props.resetKeys)) this.setState({ failed: false })
  }

  render() {
    if (!this.state.failed) return this.props.children
    const app = this.props.scope === 'app'
    return (
      <div
        role="alert"
        className={app ? 'grid min-h-screen place-items-center bg-bg px-4 text-ink' : 'py-6'}
      >
        <ErrorState
          variant="generic"
          detail="This view hit an unexpected problem. Your data is safe."
          onRetry={() => this.setState({ failed: false })}
          secondary={
            <>
              {/* plain anchors on purpose: the app boundary sits above the router */}
              <a href="/" className="inline-flex h-10 items-center rounded-r2 px-4 text-[14px] font-medium text-ink-2 hover:text-ink">Go to overview</a>
              <Button variant="ghost" onClick={() => window.location.reload()}>Reload</Button>
            </>
          }
        />
      </div>
    )
  }
}
