# volley-reel

DataVolley のスカウトファイル（.dvw）と試合動画を同期させ、
選手に見せるハイライト動画（MP4）を作るローカルアプリ（Windows / オフライン / Electron）。

- 設計図: [docs/design.md](docs/design.md)
- 状況: M0（書き出し検証）完了、M1（取り込み・DVW パース・再生）実装済み

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
3. 左のプレー一覧をクリックすると、そのプレーの 2 秒前から再生する

| キー | 動作 |
|---|---|
| `Space` | 再生 / 一時停止 |
| `←` `→` | 0.5 秒戻る / 進む |
| `Shift` + `←` `→` | 1 フレーム戻る / 進む |

## 開発用の自己チェック

試合を取り込んで指定のプレーに飛び、ウィンドウのスクリーンショットを保存して終了する。

```bash
VR_PROJECT="C:\path\to\project" VR_IMPORT="C:\video\match.mp4|C:\scout\match.dvw" VR_SMOKE="C:\path\to\smoke.png" VR_SMOKE_PLAY=40 npx electron .
```

実データの .dvw でパーサーを確かめるときは `VR_DVW_DIR=<フォルダ> npm test`。
