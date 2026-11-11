import { Fragment } from 'react'
import { t } from '../../../shared/i18n'
import { keyName } from '../../../shared/keys'
import { arrowSec, ctrlArrowSec } from '../keys'

// Every keyboard shortcut in one place, by what they are for. Keep in sync with useShortcuts.
const groups = (): { title: string; keys: [string, string][] }[] => [
  {
    title: t('再生'),
    keys: [
      ['Space', t('再生 / 一時停止')],
      ['← / →', t('{0} 秒戻る / 進む', arrowSec())],
      ['Ctrl + ← / →', t('{0} 秒戻る / 進む', ctrlArrowSec())],
      ['Shift + ← / →', t('1 フレーム戻る / 進む')],
      ['M', t('動画を最大化 / 元に戻す')],
      ['Esc', t('通し再生を止める')],
    ],
  },
  {
    title: t('プレー・クリップの移動'),
    keys: [
      ['↑ / ↓', t('前 / 次のプレーへ')],
      ['D / F', t('シーンの前 / 次のクリップへ')],
    ],
  },
  {
    title: t('クリップの整理'),
    keys: [
      [t('1 〜 5'), t('マーカーを付ける / 外す')],
      ['0', t('マーカーをすべて外す')],
      [t('Shift + 1 〜 5'), t('メモを付ける / 外す')],
      ['Shift + 0', t('メモを外す')],
      ['[ / ]', t('再生位置を IN / OUT にする')],
    ],
  },
  {
    title: t('編集'),
    keys: [
      ['Ctrl + Z', t('元に戻す')],
      ['Ctrl + Y', t('やり直す')],
      ['Ctrl + C / Ctrl + V', t('図形をコピー / 貼り付け')],
      ['Delete', t('選択中の図形を削除')],
      ['← / ↑ / → / ↓', t('選択中の図形を少し動かす（Shift で大きく）')],
      ['?', t('この一覧を開く / 閉じる')],
    ],
  },
  {
    title: t('図形の道具'),
    keys: [
      ['V', t('選択・移動')],
      ['T', t('テキスト')],
      ['A', t('矢印')],
      ['C', t('円')],
      ['R', t('四角')],
      ['G', t('三角形')],
      ['L / P', t('折れ線 / 多角形')],
    ],
  },
  {
    title: t('図形の細かい操作'),
    keys: [
      ['Alt + Enter', t('テキストの改行')],
      ['Enter', t('折れ線・多角形を確定')],
      ['Backspace', t('折れ線・多角形の頂点を 1 つ戻す')],
      ['Shift', t('つまみのドラッグで縦横比を保つ（画像は比率を外す）')],
    ],
  },
]

// A key name as key caps: "Ctrl + Z" → [Ctrl] + [Z], "← / →" → [←] / [→].
function Keys({ text }: { text: string }) {
  return <>{keyName(text).split(/( \+ | \/ )/).map((part, i) => (i % 2 ? <Fragment key={i}>{part}</Fragment> : <kbd key={i}>{part}</kbd>))}</>
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal shortcuts" role="dialog" aria-label={t('ショートカット一覧')} onClick={e => e.stopPropagation()}>
        <h2>{t('ショートカット一覧')}</h2>
        <div className="shortcut-groups">
          {groups().map(g => (
            <section key={g.title}>
              <h3>{g.title}</h3>
              <dl>
                {g.keys.map(([k, what]) => <Fragment key={k}><dt><Keys text={k} /></dt><dd>{what}</dd></Fragment>)}
              </dl>
            </section>
          ))}
        </div>
        <p className="hint">{t('文字を入力している間は、キー操作は入力欄に送られます。← → の秒数は「設定」で変えられます。')}</p>
        <div className="modal-actions"><button className="primary" onClick={onClose}>{t('閉じる')}</button></div>
      </div>
    </div>
  )
}
