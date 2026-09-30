import { Component, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { hasError: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State { return { hasError: true } }

  render() {
    if (!this.state.hasError) return this.props.children
    return <main className="auth-shell"><section className="auth-card" role="alert"><h1>页面暂时无法显示</h1><p className="lede">页面遇到意外错误，请重新加载后继续。</p><button className="primary-button" onClick={() => window.location.reload()}>重新加载</button></section></main>
  }
}
