# 身内版（src/internal）

同じコードから 2 つのアプリを作る。

- **販売版**: SyncScout Video Editor。公開リポジトリ `syncscout-video-editor-releases` から誰でもダウンロードできる
- **身内版**: SyncScout Video Editor Internal。チーム独自の分析が入る。公開しない

Electron のアプリは中の JS（`app.asar`）を誰でも取り出して読める。そのため、身内版の機能は画面で隠すのではなく、
**販売版のビルドにコードも文言も入れない**ようにしている。

身内版でも、機能が開くのは**許可されたアカウントだけ**。サーバーが署名するリース（`shared/account.ts`）の
ログインのメールアドレスが、身内版に入れた一覧（環境変数 `VR_INTERNAL_EMAILS`）にあるときに限る。
アドレスはメールのコードで確かめてあり、リースは署名付きなので、書き換えても通らない。
（リースの `apps` に `'editor-internal'`（`shared/edition.ts` の `INTERNAL_APP`）があるときも開く。サーバー側で
許可したくなったとき用で、今はサーバーは入れていない。）
一覧になければ販売版と同じ見た目で動き、身内版の機能があることも表示しない。

## 身内版だけのもの

| 機能 | コード |
|---|---|
| データスライド「サーブの狙い」（T） | `serveTargetBoard.ts`、`BoardDialogParts.tsx` の `ServeTargetHint` |
| データスライド「アタックディレクション」（D） | `attackBoard.ts`、`BoardDialogParts.tsx` の `AttackOptions` |
| 分析「得点率・ミス率」 | `pointError.ts`、`PointErrorReport.tsx` |
| 新しいプロジェクトで対象チームに `HTH` が最初から入る | `App.tsx` |

どれも、身内版のビルドで、かつ許可されたアカウントのときだけ（画面側は `renderer/src/account.ts` の `useInternal()`）。

## 仕組み

- ビルドのときの定数 `__INTERNAL__`（`electron.vite.config.ts`）。`VR_EDITION=internal` のとき true、それ以外は false。
  テストは両方の版のコードを通すので true（`vitest.config.ts`）
- 本体のコードから身内版のものを使うところは、必ず `__INTERNAL__` をそのまま書いて囲む。
  販売版のビルドでは `false` に置き換わり、囲んだ部分と、そこからしか使われないモジュールがまるごと消える
  ```ts
  const internal = useInternal()                                  // 許可されたアカウントか
  if (__INTERNAL__ && internal && skill === 'D') { … }            // ブロックごと
  ...(__INTERNAL__ && internal ? [['T', t('サーブの狙い')]] : [])  // 式の中
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
- 中のパッケージ名は `volley-reel-internal`（`extraMetadata`）。設定と、更新のダウンロード先のフォルダも販売版と別になる
- ログインは販売版と同じ仕組み。チームの契約を `free` にしておけば課金なしで使える

## 身内版の更新

```bash
npm run release:internal    # Windows のインストーラーを作り、非公開の syncscout-internal-releases に公開する
```

- 版は `package.json` の版のあとに日時が付く（`1.0.2-internal.202611231530`）。`package.json` は変えずに、何度でも出せる。
  販売版を `1.1.0` にすると、そのあとの身内版は `1.1.0-internal.…` になり、続けて更新される
- インストールした身内版は、起動時に `courtendvb/syncscout-internal-releases`（非公開）の最新リリースを見て、
  あれば販売版と同じように更新する（`main/updater.ts`）。販売版の公開リポジトリは見ない
- 機能を使える人のメールアドレスは、ビルドする PC の環境変数 `VR_INTERNAL_EMAILS`（カンマ区切り）。
  リポジトリには入れない。人を足す・外すときは、これを直して `npm run release:internal`（更新が届けば外した人には開かなくなる）
  ```
  setx VR_INTERNAL_EMAILS "a@example.com,b@example.com"
  ```
- 非公開リポジトリを読むトークンはアプリに入る。ビルドする PC の環境変数 `VR_INTERNAL_UPDATE_TOKEN` から
  （`electron.vite.config.ts`）。リポジトリには入れない。権限は **そのリポジトリの Contents: Read-only だけ**の fine-grained token にする。
  インストーラーから取り出せるので、漏れたら取り消して作り直し、身内版を出し直す（古い版はそのトークンで更新を探せなくなる）
- アップロードは GitHub CLI のログイン（`gh auth token`）で行う。販売版の `npm run release` と同じ
- `VR_INTERNAL_UPDATE_TOKEN` なしで作った身内版（`npm run dist:internal` など）は更新を探さない。`VR_INTERNAL_EMAILS` なしだと
  誰にも機能が開かない（どちらも `dist:internal` は注意を出し、`release:internal` は止まる）
- Mac の身内版は、まだ更新しない（Mac の更新は `macUpdate.ts` が公開リポジトリの URL から取るため）
- 販売版のビルドには、トークン・メールアドレス・更新先・`editor-internal` も入らない（`edition-guard.mjs` が確かめる）

## 新しく身内版の機能を足すとき

1. コードは `src/internal/` に置く（本体の `src/shared` などから import してよいが、逆は `__INTERNAL__` で囲んだ所からだけ）
2. 本体から呼ぶ所を `__INTERNAL__` で囲む
3. `npm test`（文言の置き場所）と、`npx electron-vite build && node scripts/edition-guard.mjs`（販売版に残っていないか）
4. サイトとマニュアル（`site/`）には書かない
