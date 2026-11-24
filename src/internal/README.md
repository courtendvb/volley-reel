# チーム専用の機能（src/internal）

アプリは 1 つ（SyncScout Video Editor）。そのなかに、**許可したアカウントだけ**に出す機能がある。
ほかの人には販売しているアプリと同じに見え、こうした機能があることも表示しない。

コードはアプリに入っている（このリポジトリも公開）。そのため、狙って中を書き換えれば開けられる。
守っているのは「ふつうに使う人には出ない」ところまで。知られて困るものは、ここに置かない。

## 機能

| 機能 | コード |
|---|---|
| データスライド「サーブの狙い」（T） | `serveTargetBoard.ts`、`BoardDialogParts.tsx` の `ServeTargetHint` |
| データスライド「アタックディレクション」（D） | `attackBoard.ts`、`BoardDialogParts.tsx` の `AttackOptions` |
| 分析「得点率・ミス率」 | `pointError.ts`、`PointErrorReport.tsx` |
| ポッシビリティー（Poss）のすべて: マッチレポートのサーブ欄「Poss」（画面と PDF）、プレー一覧の **P**、チーム比較の「POSS%」「POSSIBILITY/SET」 | `shared/reportHtml.ts` の `poss`、`MatchReportDialog.tsx`、`PlayList.tsx`、`shared/compare.ts` の `internal`（`rowsFor`） |
| 新しいプロジェクトで対象チームに `HTH` が最初から入る | `App.tsx` |

許可されていないアカウントでも、プロジェクトにある T・D のスライドは表示・書き出しできる。
「構成を変える…」だけが出ない（`board.ts` の `canMake`）。

## 許可する人

次のどちらかのとき、機能が開く（`shared/account.ts` の `leaseState`、画面側は `renderer/src/account.ts` の `useInternal()`）。

- ログインのメールアドレスが、ビルドする PC の環境変数 `VR_INTERNAL_EMAILS`（カンマ区切り）にある
- サーバーが署名するリースの `apps` に `'editor-internal'`（`shared/edition.ts` の `INTERNAL_APP`）がある。
  サーバー側で許可したくなったとき用で、今はサーバーは入れていない

アドレスはメールのコードで確かめてあり、リースは署名付きなので、ふつうの操作ではなりすませない。

```
setx VR_INTERNAL_EMAILS "a@example.com,b@example.com"
```

- アプリに入るのは、小文字にしたアドレスの SHA-256 だけ（`electron.vite.config.ts`）。アドレスそのものは、
  リポジトリにもアプリにも入らない
- `npm run release` は `VR_INTERNAL_EMAILS` がないと止まる（入れ忘れると、誰にも開かなくなるため）
- 人を足す・外すときは、これを直して `npm run release`（新しい版が届けば変わる）
- Mac 版は Actions（`.github/workflows/mac.yml`）でビルドし、リポジトリの Secret `VR_INTERNAL_EMAILS` を使う。
  人を足す・外すときは、こちらも同じ値に直す（`gh secret set VR_INTERNAL_EMAILS --repo courtendvb/volley-reel`）

## 機能を足すとき

1. コードは `src/internal/` に置く
2. 本体から呼ぶ所は、`useInternal()` が true のときだけ出す
3. 文言（`t('…')` の日本語）は `src/internal/i18n-en.ts`・`i18n-es.ts` に入れる（`shared/i18n.ts` が足す）
4. サイトとマニュアル（`site/`）には書かない
