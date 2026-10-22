# volley-reel

DataVolley のスカウトファイル（.dvw）と試合動画を同期させ、
選手に見せるハイライト動画（MP4）を作るローカルアプリ（Windows / オフライン / Electron）。

- 設計図: [docs/design.md](docs/design.md)
- 状況: M0（書き出し検証）完了、M1（取り込み・DVW パース・再生）、M2（検索・絞り込み・自チーム設定・名寄せ）実装済み

## 準備

1. `vendor/ffmpeg/bin/` に ffmpeg.exe / ffprobe.exe を置く（gyan.dev の essentials ビルド。git 管理外）
2. `npm install`

## 使い方

```bash
npm run dev        # 開発モードで起動
npm run build      # out/ にビルド
npm start          # ビルド結果を起動
npm test           # DVW パーサーのテスト
npm run typecheck
```

1. 「プロジェクトを開く」で保存先フォルダを選ぶ（`project.json`、`matches/*.json`、`cache/` ができる）
2. 「試合を取り込む」で動画と .dvw を選ぶ
   - 再生できる形式（H.264 4:2:0、音声 AAC など）は**元の動画をそのまま参照**する
   - リニアPCM 音声（XAVC S）は音声だけ外したコピーを、4:2:2 / 10bit などは変換したものを `cache/` に作る
3. 左のプレー一覧をクリックすると、そのプレーの 2 秒前から再生する（別の試合のプレーなら動画も切り替わる）
4. 絞り込み: 「この試合 / 全試合」、チーム（自チーム / 相手）、選手、スキル、評価、セット、ローテ、開始・終了ゾーン
   - 選手は DataVolley の選手IDで、試合をまたいで同じ人として扱う（ホーム/アウェイ、紅白戦の `-a` も統合）
   - ローテは、そのプレーをしたチームのローテ
   - 全部ホーム入力の試合はチームを区別できないので、チームで絞っても全プレーを含める
5. 「設定」で自チームのチームコード（既定 `HTH, HTA`）と名寄せ表（IDが違うのに同じ人の指定）を編集する。`project.json` に保存される

| キー | 動作 |
|---|---|
| `Space` | 再生 / 一時停止 |
| `←` `→` | 0.5 秒戻る / 進む |
| `Shift` + `←` `→` | 1 フレーム戻る / 進む |

## 開発用の自己チェック

試合を取り込み、絞り込み結果の n 番目に飛んで、ウィンドウのスクリーンショットを保存して終了する
（`VR_SMOKE_SETTINGS=1` で設定ダイアログも開く）。試合は `;` 区切りで複数指定できる。

```bash
VR_PROJECT="C:\path\to\project" VR_IMPORT="C:\video\a.mp4|C:\scout\a.dvw;C:\video\b.mp4|C:\scout\b.dvw" VR_SMOKE="C:\path\to\smoke.png" VR_SMOKE_SCOPE=all VR_SMOKE_FILTER='{"person":"YAN-YUR-02","skills":["S"]}' VR_SMOKE_PLAY=0 npx electron .
```

実データの .dvw でパーサーを確かめるときは `VR_DVW_DIR=<フォルダ> npm test`。
