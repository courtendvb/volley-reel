import { t } from '../../../shared/i18n'
// Every keyboard shortcut in one place (design M8). Keep in sync with the keydown handler in App.tsx.
const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: t('再生'),
    keys: [
      ['Space', t('再生 / 一時停止（クリップ選択中はループ再生）')],
      ['← / →', t('0.5 秒戻る / 進む')],
      ['Shift + ← / →', t('1 フレーム戻る / 進む')],
      ['↑ / ↓', t('左の一覧の前 / 次のプレーへ')],
      ['M', t('動画を最大化 / 元に戻す')],
      ['Esc', t('通し再生を止める（最大化中は元の大きさに戻すだけ）')],
    ],
  },
  {
    title: t('シーン・動画'),
    keys: [
      [t('1 〜 5'), t('選択中のクリップをグループに入れる（複数入れられる。同じ数字で解除）。シーンにないプレーなら、そのグループで追加')],
      ['0', t('すべてのグループから外す')],
      ['F / D', t('シーンの次のクリップ / 前のクリップへ（どこにフォーカスがあっても）')],
      [t('Shift + 1 〜 5'), t('選択中のクリップにメモ（並べ替え用のメモ。同じ数字で外す、Shift + 0 で外す）')],
      ['[ / ]', t('再生位置を IN / OUT にする')],
      ['Ctrl + Z', t('元に戻す')],
      ['Ctrl + Y / Ctrl + Shift + Z', t('やり直す')],
    ],
  },
  {
    title: t('注釈'),
    keys: [
      ['V', t('選択・移動')],
      ['T', t('テキスト')],
      ['A', t('矢印')],
      ['C', t('円')],
      ['R', t('四角')],
      ['G', t('三角形（ドラッグで描く）')],
      ['L / P', t('折れ線 / 多角形（クリックで頂点、ダブルクリックか Enter で確定、Backspace で1つ戻す、Esc で中止）')],
      [t('つまみをドラッグ'), t('矢印の端・図形の大きさ（Shift で縦横比を保つ。画像は逆に Shift で比率を外す。頂点・矢印の端は Shift で隣と縦横をそろえる）')],
      ['Alt+Enter', t('テキストの改行（Enter で確定）')],
      [t('「頂点の編集」'), t('頂点を動かす（四角・円は多角形になる）')],
      [t('辺の中点を引く / 頂点をダブルクリック'), t('頂点の編集中に、頂点を追加 / 削除')],
      ['Delete', t('選択中の注釈を削除')],
      ['Ctrl + C / Ctrl + V', t('選択中の図形（グループごと）をコピー / 今のクリップ・カードに貼り付け')],
      [t('Ctrl + V（画像）'), t('スクリーンショットやほかのアプリでコピーした画像を、今のクリップ・カードの中央に貼り付け（最後にコピーしたものが貼られる）')],
      [t('ダブルクリック'), t('テキストを編集')],
    ],
  },
  { title: t('その他'), keys: [['?', t('この一覧を開く / 閉じる')]] },
]

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal shortcuts" role="dialog" aria-label={t('ショートカット一覧')} onClick={e => e.stopPropagation()}>
        <h2>{t('ショートカット一覧')}</h2>
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
        <p className="hint">{t('文字を入力している間は、キー操作は入力欄に送られます。')}</p>
        <div className="modal-actions"><button className="primary" onClick={onClose}>{t('閉じる')}</button></div>
      </div>
    </div>
  )
}
