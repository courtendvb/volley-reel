// Every keyboard shortcut in one place (design M8). Keep in sync with the keydown handler in App.tsx.
const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: '再生',
    keys: [
      ['Space', '再生 / 一時停止（クリップ選択中はループ再生）'],
      ['← / →', '0.5 秒戻る / 進む'],
      ['Shift + ← / →', '1 フレーム戻る / 進む'],
      ['↑ / ↓', '左の一覧の前 / 次のプレーへ'],
      ['Esc', '通し再生を止める'],
    ],
  },
  {
    title: 'シーン・動画',
    keys: [
      ['1 〜 5', '選択中のクリップにマーカー（複数付けられる。同じ数字で解除）。シーンにないプレーなら、そのマーカーで追加'],
      ['0', 'マーカーをすべて外す'],
      ['Shift + 1 〜 5', '選択中のクリップにタグ（並べ替え用のメモ。同じ数字で外す、Shift + 0 で外す）'],
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
      ['G', '三角形（ドラッグで描く）'],
      ['F', 'フリーハンド'],
      ['L / P', '折れ線 / 多角形（クリックで頂点、ダブルクリックか Enter で確定、Backspace で1つ戻す、Esc で中止）'],
      ['つまみをドラッグ', '矢印の端・図形の大きさ（Shift で縦横比を保つ。画像は逆に Shift で比率を外す。頂点・矢印の端は Shift で隣と縦横をそろえる）'],
      ['Alt+Enter', 'テキストの改行（Enter で確定）'],
      ['「頂点の編集」', '頂点を動かす（四角・円は多角形になる）'],
      ['辺の中点を引く / 頂点をダブルクリック', '頂点の編集中に、頂点を追加 / 削除'],
      ['Delete', '選択中の注釈を削除'],
      ['Ctrl + C / Ctrl + V', '選択中の図形（グループごと）をコピー / 今のクリップ・カードに貼り付け'],
      ['Ctrl + V（画像）', 'スクリーンショットやほかのアプリでコピーした画像を、今のクリップ・カードの中央に貼り付け（最後にコピーしたものが貼られる）'],
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
