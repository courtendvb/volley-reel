# M0: 書き出し検証

設計図 §9 の検証スクリプト。UI なしで「トリム → 注釈 PNG を overlay → 連結 → 音声なし MP4」を通し、
速度・継ぎ目・注釈のにじみを測る。

## 準備

- `vendor/ffmpeg/bin/` に ffmpeg / ffprobe（gyan.dev essentials ビルド、git 管理外）。別の場所なら `FFMPEG_DIR` で指定
- `npm install`（PNG 描画に `@napi-rs/canvas` を使う。アプリ本体ではレンダラの Canvas に置き換える）

## 実行

```bash
# 実素材（試合ごとに --match を繰り返す）
node export-check.mjs --match D:/video/0314.mp4 D:/dvw/0314.dvw --match D:/video/0315.mp4 D:/dvw/0315.dvw --compare

# 素材がないとき: テストパターン動画を生成して DVW の時刻に合わせる
node export-check.mjs --synthetic ../../HTH_videoviewer/&260314HTH-SAK_0-3_5th.dvw --compare
```

| オプション | 既定 | |
|---|---|---|
| `--clips` | 5 | 試合をまたいで均等に選ぶ |
| `--res` | 720 | 出力の高さ |
| `--our` | `HTH,HTA` | 自チームのコード（スコアボードで左に置く） |
| `--compare` | off | filter_complex 一本化の書き出しも計測する |

結果は `out/<日時>/report.md`。継ぎ目の前後フレーム（`seam*.png`）、注釈の拡大（`zoom-*.png`）、
`enable` の表示中・非表示（`timed-on.png` / `timed-off.png`）も同じフォルダに出る。
