import { Component, type ReactNode } from 'react'

// Last resort: an error while drawing the screen would otherwise leave the window blank.
// Scenes and videos are saved shortly after each edit, so reloading brings back the saved state.
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('画面の表示中にエラー', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="empty" role="alert" style={{ marginTop: '20vh' }}>
        <h2>表示中にエラーが起きました</h2>
        <p className="muted">シーンと動画は編集のたびに自動で保存されています。再読み込みすると、保存された状態から続けられます。</p>
        <pre className="muted" style={{ whiteSpace: 'pre-wrap', textAlign: 'left', fontSize: 12 }}>{error.message}</pre>
        <div className="home-actions" style={{ justifyContent: 'center' }}>
          <button className="primary" onClick={() => location.reload()}>再読み込み</button>
          <button onClick={() => this.setState({ error: null })}>このまま続ける</button>
        </div>
      </div>
    )
  }
}
