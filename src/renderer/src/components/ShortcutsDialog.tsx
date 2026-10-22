// Every keyboard shortcut in one place (design M8). Keep in sync with the keydown handler in App.tsx.
const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: '再生',
    keys: [
      ['Space', '再生 / 一時停止（クリップ選択中はループ再生）'],
      ['← / →', '0.5 秒戻る / 進む'],
      ['Shift + ← / →', '1 フレーム戻る / 進む'],
      ['Esc', '通し再生を止める'],
    ],
  },
  {
    title: 'リール',
    keys: [
      ['1 〜 5', '選択中のクリップにマーカー（同じ数字で解除）。リールにないプレーなら、そのマーカーで追加'],
      ['0', 'マーカーを外す'],
      ['[ / ]', '再生位置を IN / OUT にする'],
      ['Ctrl + Z', '元に戻す'],
      ['Ctrl + Y / Ctrl + Shift + Z', 'やり直す'],
    ],
  },
  {
    title: '注釈',
    keys: [
      ['V', '選択・移動'],
      ['T', 'テキスト'],
      ['A', '矢印'],
      ['C', '円'],
      ['R', '四角'],
      ['F', 'フリーハンド'],
      ['Delete', '選択中の注釈を削除'],
      ['ダブルクリック', 'テキストを編集'],
    ],
  },
  { title: 'その他', keys: [['?', 'この一覧を開く / 閉じる']] },
]

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal shortcuts" role="dialog" aria-label="ショートカット一覧" onClick={e => e.stopPropagation()}>
        <h2>ショートカット一覧</h2>
        <div className="shortcut-groups">
          {GROUPS.map(g => (
            <section key={g.title}>
              <h3>{g.title}</h3>
              <table>
                <tbody>
                  {g.keys.map(([k, what]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{what}</td></tr>)}
                </tbody>
              </table>
            </section>
          ))}
        </div>
        <p className="hint">文字を入力している間は、キー操作は入力欄に送られます。</p>
        <div className="modal-actions"><button className="primary" onClick={onClose}>閉じる</button></div>
      </div>
    </div>
  )
}
