# 身内版（src/internal）

同じコードから 2 つのアプリを作る。

- **販売版**: SyncScout Video Editor。公開リポジトリ `syncscout-video-editor-releases` から誰でもダウンロードできる
- **身内版**: SyncScout Video Editor Internal。チーム独自の分析が入る。公開しない

Electron のアプリは中の JS（`app.asar`）を誰でも取り出して読める。そのため、身内版の機能は画面で隠すのではなく、
**販売版のビルドにコードも文言も入れない**ようにしている。

## 身内版だけのもの

| 機能 | コード |
|---|---|
| データスライド「サーブの狙い」（T） | `serveTargetBoard.ts`、`BoardDialogParts.tsx` の `ServeTargetHint` |
| データスライド「アタックディレクション」（D） | `attackBoard.ts`、`BoardDialogParts.tsx` の `AttackOptions` |
| 分析「得点率・ミス率」 | `pointError.ts`、`PointErrorReport.tsx` |
| 新しいプロジェクトで対象チームに `HTH` が最初から入る | `App.tsx` |

## 仕組み

- ビルドのときの定数 `__INTERNAL__`（`electron.vite.config.ts`）。`VR_EDITION=internal` のとき true、それ以外は false。
  テストは両方の版のコードを通すので true（`vitest.config.ts`）
- 本体のコードから身内版のものを使うところは、必ず `__INTERNAL__` をそのまま書いて囲む。
  販売版のビルドでは `false` に置き換わり、囲んだ部分と、そこからしか使われないモジュールがまるごと消える
  ```ts
  if (__INTERNAL__ && skill === 'D') { … }            // ブロックごと
  ...(__INTERNAL__ ? [['T', t('サーブの狙い')]] : [])  // 式の中
  ```
  `const x = __INTERNAL__` のように変数に入れてから使うと、消えないことがある（下の検査で分かる）
- 文言（`t('…')` の日本語）: 身内版だけで出るものは `src/internal/i18n-en.ts`・`i18n-es.ts` に入れる。
  `shared/i18n.ts` は身内版のときだけこれを足す。どちらに入れるかは `scripts/edition-strings.mjs` の決まりで判定し、
  `shared/i18n.test.ts` が確かめる。身内版だけの文言は、`src/internal` の中か、`__INTERNAL__` のある行か、
  その行で開いたブロック（`if (__INTERNAL__ …) {`）の中に書く
- 販売版で、身内版で作ったスライド（T・D）があるプロジェクトを開いた場合: スライドはそのまま表示・書き出しできる。
  「構成を変える…」だけが出ない（`board.ts` の `canMake`）

## 検査

`scripts/edition-guard.mjs` が、`electron-vite build` のあとに `out/` を調べる。

- 販売版（`npm run dist`・`dist:mac`・`release` で自動）: 身内版の文言と、`src/internal` のコードにしかない文字列が
  1 つでもあれば止まる
- 身内版（`--internal`、`dist:internal` で自動）: それらが入っているかを逆に確かめる（検査が空振りしていないか）

## 身内版の作り方

```bash
npm run dev:internal        # 開発
npm run dist:internal       # Windows のインストーラー → release-internal/
npm run dist:internal:mac   # Mac で
```

- インストーラーの設定は `electron-builder.internal.yml`（`electron-builder.yml` を引き継ぎ、appId・名前・出力先を変える）。
  販売版とは別のアプリとして並べて入る。設定フォルダも別（`volley-reel-internal`）なので、ログインと倉庫の場所はそれぞれ持つ
- 選手写真のパック（`vendor/packs`）は販売版と同じく入る
- **自動更新はない**（`publish: null`、`main/updater.ts`）。インストーラーは手で渡す。
  配る場所を作るなら、URL を知っていれば誰でも取れる場所は避けること（中身は販売版から隠しているもの）
- ログインは販売版と同じ仕組み。チームの契約を `free` にしておけば課金なしで使える

## 新しく身内版の機能を足すとき

1. コードは `src/internal/` に置く（本体の `src/shared` などから import してよいが、逆は `__INTERNAL__` で囲んだ所からだけ）
2. 本体から呼ぶ所を `__INTERNAL__` で囲む
3. `npm test`（文言の置き場所）と、`npx electron-vite build && node scripts/edition-guard.mjs`（販売版に残っていないか）
4. サイトとマニュアル（`site/`）には書かない
