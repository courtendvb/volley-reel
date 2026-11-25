# Writes site/manual/ja/*.html from the chapter bodies below: the same header, chapter list and
# previous / next links on every page.
import os
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'ja') + os.sep
CH = [
    ('index.html', 'マニュアル', '目次'),
    ('01-start.html', 'はじめに', 'インストール、ログインとお試し、言葉の意味'),
    ('02-import.html', '試合を取り込む', '倉庫に動画と DVW を入れる'),
    ('03-project.html', 'プロジェクトを作る', '分析するチームを決めて、コートを合わせる'),
    ('04-find.html', 'プレーを探す', 'プレー一覧と絞り込み'),
    ('05-scene.html', 'シーンと動画を作る', 'マーカーで並べて、MP4 に書き出す'),
    ('06-draw.html', '動画に描く', '図形とテキスト、出す時間、スロー・停止、タイトルカード、スライド'),
    ('07-court.html', 'コートの表示', 'ゾーン、軌道、ヒートマップ、コーン、セット配分、自動表示'),
    ('08-data.html', 'データスライドとレポート', 'データスライド、プリセット、マッチレポート、分析'),
    ('09-compare.html', '比較動画', '2 本の動画を並べて見比べる'),
    ('10-export.html', '書き出しの詳細', '動画の設定、書き出しの範囲、スライドと PDF'),
    ('11-help.html', '困ったとき', 'よくある質問とお問い合わせ'),
]
SOON = []

def toc(cur):
    items = []
    for i, (f, title, _) in enumerate(CH):
        label = title if i == 0 else f'{i}. {title}'
        cur_attr = ' aria-current="page"' if f == cur else ''
        items.append(f'<li><a href="{f}"{cur_attr}>{label}</a></li>')
    for j, s in enumerate(SOON):
        items.append(f'<li><span class="soon">{len(CH) + j}. {s}（準備中）</span></li>')
    return '\n        '.join(items)

def page(f, title, desc, body):
    i = [c[0] for c in CH].index(f)
    prev = CH[i - 1] if i > 0 else None
    nxt = CH[i + 1] if i + 1 < len(CH) else None
    pager = ''
    if prev or nxt:
        a = f'<a class="prev" href="{prev[0]}"><small>前へ</small>{prev[1]}</a>' if prev else ''
        b = f'<a class="next" href="{nxt[0]}"><small>次へ</small>{nxt[1]}</a>' if nxt else ''
        pager = f'<nav class="m-pager" aria-label="前後の章">{a}{b}</nav>'
    head_title = 'マニュアル — SyncScout Video Editor' if i == 0 else f'{title} — SyncScout Video Editor マニュアル'
    return f'''<!doctype html>
<html lang="ja">
<head>
<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){{w[l]=w[l]||[];w[l].push({{'gtm.start':
new Date().getTime(),event:'gtm.js'}});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
}})(window,document,'script','dataLayer','GTM-MV69LPGH');</script>
<!-- End Google Tag Manager -->
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{head_title}</title>
<meta name="description" content="{desc}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,700;1,600;1,700;1,800&family=Barlow:wght@400;500;600;700&family=Noto+Sans+JP:wght@400;500;700;800&display=swap">
<link rel="stylesheet" href="../../site.css">
<link rel="stylesheet" href="../manual.css">
</head>
<body>
<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-MV69LPGH"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->
<header class="m-top">
  <div class="wrap bar">
    <span class="brand"><a href="index.html">SyncScout <small>Video Editor マニュアル</small></a></span>
    <nav class="nav" aria-label="サイト">
      <a href="../../ja.html">製品サイト</a>
      <a href="../../ja.html#download">ダウンロード</a>
    </nav>
  </div>
</header>
<div class="wrap m-layout">
  <nav class="m-toc" aria-label="章">
    <h2>目次</h2>
    <ol>
        {toc(f)}
    </ol>
  </nav>
  <main class="m-body">
{body.strip()}
    {pager}
  </main>
</div>
</body>
</html>
'''

def site_shot(path, cap, narrow=False):
    cls = 'm-shot narrow' if narrow else 'm-shot'
    return f'<figure class="{cls}"><img src="../../img/{path}" alt="{cap}" loading="lazy"><figcaption>{cap}</figcaption></figure>'

def shot(name, cap, narrow=False, alt=None):
    cls = 'm-shot narrow' if narrow else 'm-shot'
    return f'<figure class="{cls}"><img src="../img/ja/{name}.jpg" alt="{alt or cap}" loading="lazy"><figcaption>{cap}</figcaption></figure>'

BODY = {}

BODY['index.html'] = '''
<h1>SyncScout Video Editor マニュアル</h1>
<p class="m-lead">DataVolley や VolleyStation のスカウトファイルと試合動画から、ミーティング用の映像を作るまでの手順です。上から順に読むと、最初の動画を書き出すところまで進めます。</p>
<ol class="m-cards">
  <li><a href="01-start.html"><b><i>1</i>はじめに</b><span>インストール、ログインと 14 日のお試し、アプリの中の言葉</span></a></li>
  <li><a href="02-import.html"><b><i>2</i>試合を取り込む</b><span>倉庫を決めて、動画と DVW を組にして入れる</span></a></li>
  <li><a href="03-project.html"><b><i>3</i>プロジェクトを作る</b><span>分析するチームを選び、コートのグリッドを確かめる</span></a></li>
  <li><a href="04-find.html"><b><i>4</i>プレーを探す</b><span>プレー一覧の見方と、チーム・選手・スキル・評価での絞り込み</span></a></li>
  <li><a href="05-scene.html"><b><i>5</i>シーンと動画を作る</b><span>プレーをマーカーで分けて並べ、MP4 に書き出す</span></a></li>
  <li><a href="06-draw.html"><b><i>6</i>動画に描く</b><span>図形とテキスト、出す時間、スロー・停止、タイトルカード、スライド</span></a></li>
  <li><a href="07-court.html"><b><i>7</i>コートの表示</b><span>ゾーン、軌道、ヒートマップ、コーン、セット配分、自動表示</span></a></li>
  <li><a href="08-data.html"><b><i>8</i>データスライドとレポート</b><span>データスライド、プリセット、マッチレポート、分析</span></a></li>
  <li><a href="09-compare.html"><b><i>9</i>比較動画</b><span>2 本の動画を並べて見比べる</span></a></li>
  <li><a href="10-export.html"><b><i>10</i>書き出しの詳細</b><span>動画の設定、書き出しの範囲、スライドと PDF</span></a></li>
  <li><a href="11-help.html"><b><i>11</i>困ったとき</b><span>よくある質問とお問い合わせ</span></a></li>
</ol>
<div class="m-note">
  <p>このマニュアルの画面は、架空のチーム Riverside Herons の架空のスカウトデータで撮っています。アプリは 0.2.40 です。</p>
</div>
'''

BODY['01-start.html'] = '''
<h1>1. はじめに</h1>
<p class="m-lead">アプリを入れて、ログインし、アプリの中で使う言葉を知るところまでです。</p>

<h2 id="install">インストール</h2>
<p><a href="../../ja.html#download">製品サイトのダウンロード</a>から、お使いのパソコンに合うものを入れます。動画もスカウトファイルもパソコンの中だけで扱い、どこにも送りません。</p>
<h3>Windows</h3>
<ol class="m-steps">
  <li>「Windows 版をダウンロード」でインストーラー（<code>syncscout-video-editor-setup-…exe</code>）を保存し、開きます。</li>
  <li>「Windows によって PC が保護されました」と出たら、<span class="ui">詳細情報</span>を押してから<span class="ui">実行</span>を押します。アプリにまだ署名がないために出る表示です。</li>
  <li>画面の案内に沿って進めると、デスクトップとスタートメニューに SyncScout Video Editor が入ります。</li>
</ol>
<p>新しい版が出ると、アプリの上に「新しいバージョン … の準備ができました」と出ます。<span class="ui">再起動して更新</span>を押すか、アプリを閉じたときに更新されます。</p>
<h3>Mac</h3>
<ol class="m-steps">
  <li>アップルメニューの「このMacについて」で、「チップ」が Apple M… なら Apple シリコン版、「プロセッサ」が Intel なら Intel 版をダウンロードします。</li>
  <li>ディスクイメージを開き、アプリを「アプリケーション」フォルダへドラッグします。</li>
  <li>初めて開くときは、「システム設定」→「プライバシーとセキュリティ」→<span class="ui">このまま開く</span>で開きます。Apple の署名がまだないためです。</li>
</ol>
<p>Mac では自動で更新されません。新しい版は製品サイトから入れ替えます。</p>

<h2 id="login">ログインと 14 日のお試し</h2>
<p>ログインしなくても、1 試合を取り込んで編集まで試せます。2 試合目からの取り込みと、すべての書き出しにはログインが要ります。</p>
<div class="m-scroll"><table class="m-table">
  <thead><tr><th>ログインしなくてもできること</th><th>ログイン（お試し中・契約中）が必要なこと</th></tr></thead>
  <tbody><tr>
    <td>1 試合の取り込み<br>その試合でのプロジェクト・シーン・動画の作成と編集<br>図形・スライド・ボードの作成とプレビュー</td>
    <td>2 試合目からの取り込み<br>動画（MP4）の書き出し<br>スライドの書き出し（PNG・PDF・PowerPoint）<br>マッチレポートの PDF 書き出し</td>
  </tr></tbody>
</table></div>
<ol class="m-steps">
  <li>ホーム画面の右上、「プロジェクト」の横の<span class="ui">ログイン</span>を押します。</li>
  <li>メールアドレスを入れて<span class="ui">コードを送る</span>を押し、届いた確認コードを入れます。パスワードはありません。コードが届かないときは迷惑メールのフォルダも見てください。</li>
  <li>使うチームを選びます。
    <ul class="dots">
      <li><b>初めて使う</b>：<span class="ui">無料お試しを始める</span>で自分のチームができ、14 日間すべて使えます。カードの登録はいりません。お試しが終わっても自動で課金はされません。チーム ID とパスコードは自動で決まり、ログインしたメールアドレスに届きます（下の「SyncScout Web に入る」）。</li>
      <li><b>SyncScout をすでに使っている</b>：チームの管理者から聞いたチーム ID と、パスコードか管理者パスコードで参加します。チームの契約のまま使えます。契約の管理・解約もする人は、管理者パスコードで参加してください。</li>
    </ul>
  </li>
</ol>
''' + shot('login', 'ログインの画面。ログインなしでできることと、ログインが要ることが並んでいます。', narrow=True) + '''
<h3 id="web">SyncScout Web に入る</h3>
<p>アプリでお試しを始めると、SyncScout Web（<code>app.syncscout.courtend.net</code>）で使うチーム ID・パスコード・管理者パスコードが自動で作られます。試合を選手やスタッフに見せる、試合を公開・削除する、パスコードを変えるといった作業は Web で行います。</p>
<ul class="dots">
  <li><b>メール</b>：お試しを始めたときに、3 つの値と Web の入り口をログインしたメールアドレスへ送ります。</li>
  <li><b>アプリ</b>：ログインの画面の<span class="ui">SyncScout Web に入るときの情報</span>で、いつでも確かめられます。Web で変えたあとも最新の値が出ます。<span class="ui">コピー</span>、<span class="ui">SyncScout Web を開く</span>、<span class="ui">管理者ページを開く</span>もここにあります。パスコードが出るのはチームの管理者だけです。</li>
</ul>
<div class="m-scroll"><table class="m-table">
  <thead><tr><th>値</th><th>使い道</th></tr></thead>
  <tbody>
    <tr><td>チーム ID</td><td>Web に入るときに、どちらのパスコードとも一緒に入れます。</td></tr>
    <tr><td>パスコード</td><td>選手・スタッフが Web で試合を見るときに使います。ほかの人がこのアプリでチームに参加するときの合言葉もこれです。</td></tr>
    <tr><td>管理者パスコード</td><td>Web の管理者ページに入るときに使います。選手には教えないでください。アプリでこれを使って参加した人は、チームの管理者になります。</td></tr>
  </tbody>
</table></div>
<p>チーム ID と 2 つのパスコードは、Web の管理者ページでわかりやすいものに変えられます。</p>
<div class="m-note">
  <strong>お試しや契約が終わったら</strong>
  <p>試合の追加、新しいプロジェクト、書き出しができなくなります。作ったプロジェクトはそのまま開いて編集でき、パソコンの中のデータが消えることはありません。契約は<span class="ui">契約を確認</span>から始められます。</p>
</div>
<div class="m-note">
  <strong>解約するときは</strong>
  <p>チームの管理者か支払いをしている人が、ログインの画面の<span class="ui">契約の管理・解約</span>から行います（<a href="11-help.html#cancel">11 章</a>）。</p>
</div>
<div class="m-note">
  <strong>インターネットにつながらない会場で</strong>
  <p>ログインの確認は、つながらない状態でも 30 日まで有効です。それを過ぎたら、一度インターネットにつないでアプリを開くと延びます。</p>
</div>

<h2 id="words">アプリの中の言葉</h2>
<div class="m-scroll"><table class="m-table">
  <thead><tr><th>言葉</th><th>意味</th></tr></thead>
  <tbody>
    <tr><td><b>倉庫</b></td><td>取り込んだ試合（動画と DVW の組）の一覧です。パソコンに 1 つ作り、すべてのプロジェクトで使います。動画と DVW はコピーせず、もとの場所のまま使います。</td></tr>
    <tr><td><b>プロジェクト</b></td><td>分析するチーム 1 つと、その試合の集まりです。チームごとに 1 つ作るのがお勧めです。</td></tr>
    <tr><td><b>プレー</b></td><td>DVW の 1 行（サーブ、レセプション、アタックなど）です。</td></tr>
    <tr><td><b>クリップ</b></td><td>プレーの前後を切り出した、動画の短い区間です。</td></tr>
    <tr><td><b>マーカー</b></td><td>クリップに付ける 1〜5 の番号です。シーンの中で、クリップをマーカーごとのまとまりに分けます。</td></tr>
    <tr><td><b>シーン</b></td><td>マーカーで分けたクリップの並びです。「エースのサーブ」「ミスしたレセプション」のような、見せたいテーマ 1 つ分です。</td></tr>
    <tr><td><b>動画</b></td><td>シーンを並べたもので、これを MP4 に書き出します。シーンの前にはタイトルカードが入ります。</td></tr>
  </tbody>
</table></div>
'''

BODY['02-import.html'] = '''
<h1>2. 試合を取り込む</h1>
<p class="m-lead">試合の動画と、その試合の DVW（DataVolley・VolleyStation のスカウトファイル）を組にして、倉庫に入れます。</p>
''' + shot('home-empty', 'はじめて開いたホーム画面。左が倉庫、右がプロジェクトです。') + '''
<h2 id="library">倉庫を決める</h2>
<p>はじめて開くと、倉庫にするフォルダを聞かれます。空のフォルダを選ぶと、そこが新しい倉庫になります。前に使っていた倉庫のフォルダを選べば、そのまま続きから使えます。あとから<span class="ui">倉庫を変更</span>で切り替えられます。</p>
<div class="m-note warn">
  <strong>動画と DVW は動かさないでください</strong>
  <p>倉庫は動画と DVW をコピーせず、もとの場所を覚えています。ファイルを移したり名前を変えたりすると見つからなくなります。そのときは、見つからないファイルの横に出る<span class="ui">場所を指定…</span>で、新しい場所を選び直します。</p>
</div>

<h2 id="folders">フォルダからまとめて取り込む</h2>
<ol class="m-steps">
  <li>ホームの<span class="ui">フォルダから一括取り込み</span>を押し、動画と DVW のあるフォルダを選びます。いくつ選んでもかまいません。</li>
  <li>見つかった DVW と動画が、日付とチームコードで組になって並びます。「判定」に、どう組にしたかが出ます。</li>
  <li>組が違っていたら、その行の動画を選び直します。入れたくない行はチェックを外します。</li>
  <li><span class="ui">◯ 試合を取り込む</span>を押します。</li>
</ol>
''' + shot('import-scan', '一括取り込みの画面。4 つの DVW がそれぞれの動画と組になっています。') + '''
<div class="m-scroll"><table class="m-table">
  <thead><tr><th>判定</th><th>意味</th></tr></thead>
  <tbody>
    <tr><td>日付とチーム</td><td>日付と両チームのコードがファイル名で合いました。</td></tr>
    <tr><td>日付と片方のチーム</td><td>日付と、チームコードの片方が合いました。</td></tr>
    <tr><td>日付のみ（要確認）</td><td>日付しか合っていません。動画が正しいか確かめてください。</td></tr>
    <tr><td>同じフォルダ</td><td>DVW と同じフォルダにある動画です。</td></tr>
    <tr><td>動画なし</td><td>合う動画がありません。動画を自分で選びます。</td></tr>
  </tbody>
</table></div>
<p>動画のファイル名に、<code>2026-10-10 RSH vs HCF.mp4</code> のように日付とチームコードを入れておくと、正しく組になります。</p>

<h2 id="one">1 試合だけ取り込む</h2>
<p><span class="ui">1試合を取り込む</span>を押し、試合の動画、次にスカウトファイル（.dvw か .vsm）の順に選びます。</p>

<h2 id="notes">取り込むときに知っておくこと</h2>
<ul class="dots">
  <li><b>DVW は、その動画と同期したものを使います。</b>クリップは DVW に記録された時刻で切り出します。DataVolley や VolleyStation で、動画との時刻合わせを済ませた DVW を使ってください。試合全体が同じだけずれているときは、アプリの<b>時刻合わせ</b>で直せます（<a href="11-help.html#timing">11 章</a>）。DVW の時刻が動画の長さを超えているときは、取り込みのときに知らせます。</li>
  <li><b>そのままでは再生できない形式の動画</b>は、取り込みのときに再生できる形式に変換します。長い動画は時間がかかります。</li>
  <li>ログインしていない間は、倉庫に入れられるのは 1 試合までです。</li>
</ul>

<h2 id="list">倉庫の一覧</h2>
''' + shot('library', '4 試合を取り込んだ倉庫。右に作ったプロジェクトが出ます。') + '''
<ul class="dots">
  <li>上の欄にチームコードや日付を入れると絞り込めます（例：<code>RSH 2026-10</code>）。</li>
  <li><span class="ui">◯◯ で開く</span>は、その 1 試合だけのプロジェクトを、そのチームを分析対象にして開きます。1 試合をすぐ見たいときに使います。</li>
  <li><span class="ui">削除</span>は倉庫から外すだけで、動画と DVW のファイルは消えません。</li>
</ul>
'''

BODY['03-project.html'] = '''
<h1>3. プロジェクトを作る</h1>
<p class="m-lead">分析するチームを 1 つ決めて、そのチームの試合をまとめます。自チームの振り返りも、相手チームの分析も、チームごとにプロジェクトを作ります。</p>

<h2 id="new">新しいプロジェクト</h2>
<ol class="m-steps">
  <li>ホームの<span class="ui">新しいプロジェクト</span>を押します。</li>
  <li><b>名前</b>を入れます（例：<code>Riverside Herons 2026</code>）。</li>
  <li><b>対象チーム</b>を選びます。倉庫の試合に出てくるチームから選び、そのチームが出ている試合が候補に並びます。</li>
  <li>使う試合にチェックを入れます。<span class="ui">候補をすべて選ぶ</span>で全部選べます。</li>
  <li><span class="ui">作成</span>を押します。プロジェクトは倉庫の中の projects フォルダにできます。別の場所に置きたいときは<span class="ui">場所を選んで作成…</span>を使います。</li>
</ol>
''' + shot('new-project', '対象チームに RSH を選び、4 試合すべてにチェックを入れたところ。') + '''
<div class="m-note">
  <strong>対象チームはプロジェクトの「自チーム」です</strong>
  <p>ホームでもアウェイでも、対象チームが「自チーム」になります。スコアボードの左に出て、プレー一覧の「チーム」の絞り込みでも自チームとして扱います。相手チームを分析するときは、相手を対象チームにしたプロジェクトを作ります。</p>
</div>
<p>あとから試合を足したり外したりするには、画面の上の<span class="ui">試合 4</span> のようなボタンを押します。</p>

<h2 id="court">コートのグリッドを確かめる</h2>
<p>試合を初めて開くと、アプリが動画の中のコートの線を探して、グリッドを自動で合わせます。このグリッドで、ゾーンや軌道、ヒートマップを動画のコートの上に描きます。</p>
''' + shot('court-autofit', '自動で合わせた直後。動画の四隅の丸がコートの角に乗っているか確かめて、「完了」を押します。') + '''
<ol class="m-steps">
  <li>グリッドの四隅の丸が、エンドラインとサイドラインの交わる角に乗っているか見ます。ずれていたら丸をドラッグして直します。</li>
  <li><b>手前のチーム（第1セット）</b>が正しいか確かめます。カメラ側のコートにいるチームです。セットごとと、第 5 セットの 8 点でのコートチェンジは、アプリが計算します。</li>
  <li><span class="ui">完了</span>を押します。グリッドは試合ごとに保存され、ほかのプロジェクトでも使われます。</li>
</ol>
<p>自動で見つからなかったときや、あとで直したいときは、動画の下の<span class="ui">表示</span>タブの一番下にある「コートの準備」を開いて、合わせ直せます。</p>

<h2 id="screen">編集画面の見方</h2>
''' + shot('scene', 'プロジェクトを開いた画面。左がプレー一覧、真ん中が動画、右がシーン。') + '''
<div class="m-scroll"><table class="m-table">
  <thead><tr><th>場所</th><th>中身</th></tr></thead>
  <tbody>
    <tr><td>左</td><td>プレーの絞り込みと、プレー一覧です。<a href="04-find.html">4 章</a>で説明します。</td></tr>
    <tr><td>真ん中</td><td>動画と、その下の 3 つのタブです。<b>編集</b>はクリップの範囲やスロー、<b>図形・コメント</b>は動画に描くもの、<b>表示</b>はスコアボードやコートの表示です。</td></tr>
    <tr><td>右</td><td><b>シーン</b>、<b>動画の構成</b>、<b>書き出し</b>の 3 つのタブです。<a href="05-scene.html">5 章</a>で説明します。</td></tr>
    <tr><td>上</td><td>ホームに戻る、試合の出し入れ、プリセットから作る、データスライド、マッチレポート、分析、ショートカット、設定です。</td></tr>
  </tbody>
</table></div>
<p>キー操作の一覧は、<kbd>?</kbd> キーか上の<span class="ui">ショートカット</span>で開けます。</p>
'''

BODY['04-find.html'] = '''
<h1>4. プレーを探す</h1>
<p class="m-lead">左のプレー一覧から、見せたいプレーを絞り込みます。プレーを押すと、その場面が動画で再生されます。</p>

<h2 id="list">プレー一覧</h2>
<p>1 行が DVW の 1 プレーです。左から、セット、そのときの得点、チーム、背番号と選手名、ボールの向き（↑↓）、スキルと評価、アタックのコンビやゾーンが並びます。</p>
<ul class="dots">
  <li>行を押すと、そのプレーの少し前から再生します（決まった範囲を繰り返します）。</li>
  <li><kbd>↑</kbd> <kbd>↓</kbd> で前後のプレーへ、<kbd>Space</kbd> で再生と一時停止、<kbd>←</kbd> <kbd>→</kbd> で少し戻る・進む、<kbd>Shift</kbd> + <kbd>←</kbd> <kbd>→</kbd> で 1 フレームずつ動かせます。</li>
  <li>右端の <b>1〜5</b> は、プレーをシーンに入れるボタンです（<a href="05-scene.html">5 章</a>）。</li>
</ul>

<h2 id="filter">絞り込み</h2>
''' + shot('filter', 'チームを RSH、スキルを Attack、評価を # Kill にしたところ。3,222 プレーから 210 プレーに絞れています。', narrow=True) + '''
<div class="m-scroll"><table class="m-table">
  <thead><tr><th>項目</th><th>使い方</th></tr></thead>
  <tbody>
    <tr><td>試合</td><td>一番上の欄で、全試合か 1 試合かを選びます。<span class="ui">古い試合から</span>・<span class="ui">新しい試合から</span>で並び順が変わります。</td></tr>
    <tr><td>チーム</td><td>すべて、自チーム（対象チーム）、相手から選びます。</td></tr>
    <tr><td>切り出し</td><td>クリップの長さです。<b>プレー前後</b>は選んだプレーの何秒前から何秒後まで（キープレー −3 〜 +4 秒など）、<b>ラリー終わりまで</b>はラリーの最後までです。<b>通しで見る</b>にすると、ラリー単位でサーブから最後まで続けて流します。</td></tr>
    <tr><td>プレーの向き</td><td>画面でボールが上に向かうか下に向かうかで絞ります。コートのグリッドを合わせた試合だけで使えます。</td></tr>
    <tr><td>選手</td><td>1 人でも、何人でも選べます。</td></tr>
    <tr><td>スキル</td><td>Serve、Reception、Attack、Block、Dig、Set です。いくつ選んでもかまいません。</td></tr>
    <tr><td>評価</td><td># + ! - / = の評価です。スキルを選ぶと、そのスキルでの意味（Kill、Error など）が出ます。</td></tr>
    <tr><td>試合の状況</td><td>セット、ローテーション、相手ローテ、前衛にいる選手、局面（レセプションからか切り返しか）、レセプションの評価、直前・直後のプレーで絞ります。</td></tr>
    <tr><td>詳細</td><td>テンポ、コンビ（アタックコンビとセッターコール）、打ち方、ゾーンで絞ります。</td></tr>
  </tbody>
</table></div>
<p>何も選んでいない項目は「すべて」です。下に、絞り込んだ件数と全体の件数が出ます（例：210 / 3,222 プレー）。</p>
<ul class="dots">
  <li><span class="ui">条件をクリア</span>で、絞り込みをすべて外します。</li>
  <li><span class="ui">＋ 今の条件を保存</span>で、よく使う条件に名前を付けて残せます。押すとその条件に戻ります。</li>
  <li><span class="ui">結果をシーンに追加</span>で、絞り込んだプレーをまとめて今のシーンに入れます。</li>
</ul>

<h2 id="code">コードを直す</h2>
<p>スカウトの入力ミス（評価や選手の間違いなど）は、アプリの中で直せます。いちばん手早いのは、プレー一覧でプレーを選んで <kbd>Enter</kbd> を押すことです。コードだけが 1 行で開くので、書き換えて <kbd>Enter</kbd> を押すと保存して次のプレーが開きます。<kbd>↑</kbd> <kbd>↓</kbd> で前後のプレーへ移り（書き換えていれば保存します）、<kbd>Esc</kbd> で閉じます。続けて何本も直すときはこれが速いです。項目ごとに選んで直したいときや、削除・追加は、行を<b>右クリック</b>して<span class="ui">コードを直す</span>を開き、選手・スキル・打ち方・評価・コンビ・開始ゾーン・終了ゾーン・サブゾーンを選ぶか、コードを直接書き換えて<span class="ui">保存</span>を押します。</p>
<ul class="dots">
  <li>直したプレーには、一覧に印が付きます。✎ はコード、⌖ は座標を直したプレー、＋ は足したプレーです。絞り込み、レポート、データスライド、コートの表示は、すべて直したコードで数えます。</li>
  <li>直したプレーがある試合では、一覧の上に<span class="ui">修正したプレーだけ</span>と<span class="ui">削除したプレーも表示</span>が出ます。見直すときは<span class="ui">修正したプレーだけ</span>で絞れます。</li>
  <li>直した内容は倉庫に保存され、スカウトファイルそのものは書き換えません。<span class="ui">元のコードに戻す</span>でいつでも戻せます。</li>
  <li>あとでスカウトファイルを差し替えて、その行のコードが変わっていたときは、直した内容は使われません。</li>
</ul>
<h3>座標（打った位置と落ちた位置）を直す</h3>
<p>プレーの始まりの点と終わりの点も直せます。直した座標は、コートの表示（点・軌道・ヒートマップ・チャート）に使われます。</p>
<ul class="dots">
  <li><b>動画のコートの上で</b>：プレーを選んで<span class="ui">編集</span>タブの<span class="ui">◎ コートで座標を直す</span>を押し、動画のコートの上を始まりの点から終わりの点へドラッグします。コートのグリッドを合わせた試合で使えます。今の点が緑（始まり）と赤（終わり）で出るので、点を 1 つだけドラッグして動かすか、始まりから終わりへドラッグし直します。動画は止まり、続けて何度でも直せます。<kbd>Esc</kbd> で終わります。</li>
  <li><b>コート図で</b>：<span class="ui">コードを直す</span>のダイアログ（または編集タブの<span class="ui">コート図で直す…</span>）の、上から見たコートの図で同じようにドラッグします。緑の点が始まり、赤の点が終わりで、点だけをドラッグして動かすこともできます。図はそのプレーのチームの側が下です。</li>
</ul>
<p>サーブとアタックでは、点を動かした位置のゾーンとコードのゾーンが違うと知らせが出ます。<span class="ui">ゾーンも合わせる</span>を押すと、コードの開始ゾーン・終了ゾーン・サブゾーンを点の位置に合わせます。ダイアログでも同じボタンが出ます。</p>
<p><span class="ui">座標を消す</span>で点を外し、<span class="ui">ファイルの座標に戻す</span>で元に戻せます。レセプションとディグの線は、相手のサーブ・アタックの座標から描きます。</p>
<h3>プレーを削除する・足す</h3>
<p>同じダイアログの<span class="ui">このプレーを削除</span>で、入力ミスで入ったプレーを外せます。確認は出ずにすぐ消え、上に出る知らせの<span class="ui">元に戻す</span>か <kbd>Ctrl</kbd> + <kbd>Z</kbd> で戻せます。あとから戻すときは<span class="ui">削除したプレーも表示</span>にすると、消したプレーが薄く出るので、その行を右クリックします。削除したプレーがシーンに入っていたときは、そのクリップは再生できなくなります。</p>
<p><span class="ui">この後にプレーを足す…</span>では、入力し忘れたプレーをそのプレーの後に入れます。時刻は、動画の再生位置か、そのプレーの 1 秒後から始まります。<span class="ui">今の位置</span>で動画の再生位置を時刻にし、<span class="ui">−1f</span> <span class="ui">+1f</span> で 1 コマずつ動かせます（動画もその時刻に動きます）。</p>
<h3>直したスカウトファイルを書き出す</h3>
<p>ダイアログの<span class="ui">この試合の修正と書き出し…</span>で、その試合の修正の一覧が開きます。1 件ずつ、またはすべてを元に戻せます。</p>
<ul class="dots">
  <li><span class="ui">DVW で書き出す…</span>：修正を入れた .dvw を、元とは別のファイルに書き出します。DataVolley で開けます。VolleyStation の .vsm から取り込んだ試合でも書き出せます。</li>
  <li><span class="ui">VSM で書き出す…</span>：VolleyStation の .vsm から取り込んだ試合だけ使えます。修正を入れた .vsm を書き出します。</li>
</ul>
<p>元のスカウトファイルに上書きすることはできません。</p>
'''

BODY['05-scene.html'] = '''
<h1>5. シーンと動画を作る</h1>
<p class="m-lead">見せたいプレーをシーンに入れてマーカーで分け、シーンを動画に並べて MP4 に書き出します。</p>

<h2 id="scene">シーンにプレーを入れる</h2>
<ol class="m-steps">
  <li>はじめてのときは、右の<span class="ui">動画を作成</span>と<span class="ui">シーンを作成</span>を押します。「動画 1」と「シーン 1」ができます。</li>
  <li>プレー一覧の右端の <b>1〜5</b> を押すと、そのプレーがそのマーカーで今のシーンに入ります。行を選んでから数字キー <kbd>1</kbd>〜<kbd>5</kbd> を押しても同じです。</li>
  <li>右のシーンに、マーカーごとにクリップが並びます。</li>
</ol>
''' + shot('scene', 'アタックの決定をマーカー 1 に 3 本、マーカー 2 に 2 本入れたところ。動画の上には、スコアボード、選手名、アタックの軌道が自動で出ます。') + '''
<ul class="dots">
  <li>同じ数字をもう一度押すとマーカーが外れます。<kbd>0</kbd> ですべて外れます。1 つのプレーに、いくつでもマーカーを付けられます。</li>
  <li>マーカーの名前（「マーカー 1」など）は、押すと書き換えられます。タイトルカードにこの名前が出ます。</li>
  <li>左の ⠿ をドラッグすると、クリップやマーカーの順番を変えられます。</li>
  <li><b>マーカーなし</b>のクリップは、再生にも書き出しにも入りません。</li>
  <li><kbd>D</kbd> <kbd>F</kbd> で、シーンの前後のクリップへ移ります。</li>
</ul>

<h2 id="clip">クリップの長さを変える</h2>
<p>クリップを選ぶと、動画の下の<span class="ui">編集</span>タブに、そのクリップの範囲が出ます。紫の帯の両端をドラッグするか、IN・OUT の秒数を入れて変えます。秒数はキープレー（そのプレーの時刻）からの相対値です。<kbd>[</kbd> <kbd>]</kbd> で、今の再生位置を IN・OUT にできます。<span class="ui">＋ スロー</span>と<span class="ui">＋ 停止</span>で、クリップの一部をゆっくり流したり、止めたりできます。</p>

<h2 id="video">シーンを動画に並べる</h2>
''' + shot('video-compose', '「動画の構成」タブ。動画 1 にシーン 1 が入っています。', narrow=True) + '''
<ol class="m-steps">
  <li>右の<span class="ui">動画の構成</span>タブを開きます。</li>
  <li><span class="ui">＋ 新しいシーン</span>で別のシーンを作るか、<span class="ui">作ったシーンを入れる…</span>から既にあるシーンを選んで入れます。</li>
  <li>シーンをドラッグして順番を決めます。<span class="ui">カード</span>で、シーンの前のタイトルカードを出すかどうかを切り替えます。</li>
</ol>
<p>1 つのシーンは、いくつの動画に入れてもかまいません。シーンを直すと、そのシーンを使っているすべての動画に反映されます。</p>

<h2 id="export">MP4 に書き出す</h2>
''' + shot('export', '「書き出し」タブ。すべて、シーンだけ、マーカーだけから選べます。', narrow=True) + '''
<ol class="m-steps">
  <li>右の<span class="ui">書き出し</span>タブを開きます。</li>
  <li>書き出す範囲を選びます。<b>すべて書き出し</b>は動画全体、ほかに 1 つのシーンだけ、1 つのマーカーだけも選べます。</li>
  <li><span class="ui">↓ MP4 に書き出す</span>を押し、保存先を選びます。</li>
</ol>
<ul class="dots">
  <li>動画の上に見えているもの（コートのグリッド、ゾーン、チャート、セット配分など）は、そのまま書き出しにも入ります。</li>
  <li>フェード、タイトルカード、スコアボードやテロップの見た目は、<span class="ui">動画の設定</span>で変えます（<a href="10-export.html">10 章</a>）。</li>
  <li><b>YouTube のチャプターも書き出す</b>にすると、シーンの始まりを YouTube のチャプターにしたテキストファイルが MP4 の横にできます。</li>
  <li>書き出しにはログイン（お試し中か契約中）が必要です。</li>
</ul>
<div class="m-note">
  <p>ここまでで、最初の動画ができました。図形やテキストを足すには <a href="06-draw.html">6 章</a>、コートの上のデータの出し方は <a href="07-court.html">7 章</a>へ進みます。</p>
</div>
'''

BODY['06-draw.html'] = '''
<h1>6. 動画に描く</h1>
<p class="m-lead">クリップの上に、見出し、矢印、円、テキスト、画像を描きます。出す時間を決めたり、スローや停止を入れたりして、伝えたいことを足します。</p>
''' + site_shot('ja/finish-annotate.jpg', '見出し、2 枚ブロックを囲む円、空いたコートへの矢印、メモを足したアタック。') + '''
<h2 id="tools">図形・コメントの道具</h2>
<p>シーンのクリップを選び、動画の下の<span class="ui">図形・コメント</span>タブを開きます。道具を選んで、動画の上をドラッグして描きます。</p>
''' + shot('objects', '「図形・コメント」タブ。上に道具、下に次に描く図形の書式が並びます。', narrow=True) + '''
<div class="m-scroll"><table class="m-table">
  <thead><tr><th>道具</th><th>キー</th><th>使い方</th></tr></thead>
  <tbody>
    <tr><td>選択</td><td><kbd>V</kbd></td><td>描いた図形を選んで動かします。つまみで大きさを変えます。<kbd>Shift</kbd> + クリックで複数選べます。</td></tr>
    <tr><td>テキスト</td><td><kbd>T</kbd></td><td>押した場所に文字を書きます。<kbd>Alt</kbd> + <kbd>Enter</kbd> で改行します。</td></tr>
    <tr><td>矢印・曲線の矢印</td><td><kbd>A</kbd></td><td>始点から終点へドラッグします。曲線の矢印は、青い点を動かして曲げます。</td></tr>
    <tr><td>円・四角・三角形</td><td><kbd>C</kbd> <kbd>R</kbd> <kbd>G</kbd></td><td>ドラッグで描きます。三角形は、打った点から広がるコースを示すのに使えます。</td></tr>
    <tr><td>折れ線・多角形</td><td><kbd>L</kbd> <kbd>P</kbd></td><td>クリックで頂点を置き、ダブルクリックか <kbd>Enter</kbd> で確定します。<kbd>Backspace</kbd> で 1 つ戻ります。</td></tr>
    <tr><td>フリーハンド</td><td></td><td>ドラッグしたとおりに線を描きます。</td></tr>
    <tr><td>丸付き数字</td><td></td><td>クリックごとに 1、2、3… と番号の付いた円を置きます。</td></tr>
    <tr><td>コート上の四角形・円柱</td><td></td><td>コートの遠近に合わせて、床の上に四角形や円柱を置きます。コートのグリッドを合わせた試合で使います。</td></tr>
    <tr><td>画像・PDF…</td><td></td><td>ロゴや図などの画像、PDF の 1 ページ目を動画の上に置きます。</td></tr>
    <tr><td>ゾーンを塗る</td><td></td><td>小さなコートでゾーン（9 か 81 区画）を選び、動画のコートの上に塗ります。</td></tr>
  </tbody>
</table></div>
<p>書式（線の色と太さ、線の種類、矢印の向き、塗り、文字の色と大きさ、太字、縁取り、枠）は、描く前に決めても、描いたあとに図形を選んで変えてもかまいません。<kbd>Ctrl</kbd> + <kbd>C</kbd> / <kbd>V</kbd> で図形をコピーでき、<kbd>Ctrl</kbd> + <kbd>Z</kbd> で元に戻せます。</p>

<h2 id="headline">見出し</h2>
<p>タブの横の<b>見出し</b>の欄に文字を入れると、動画の上の中央に大きく出ます（例：「ラインを抑える」）。そのクリップで伝えたい一言に使います。</p>

<h2 id="time">出す時間と動き</h2>
<ul class="dots">
  <li>動画の下の<b>表示時間</b>のバーに、選んだ図形の出る時刻と消える時刻がオレンジの線で出ます。両端をドラッグして決めます。</li>
  <li><b>フェードイン</b>は、出るときと消えるときにじわっと変わる秒数です。<b>描くアニメーション</b>にすると、線が始点から伸び、円が描かれていくように出ます。</li>
  <li><b>目立たせる</b>のパルス・点滅・波紋は、出ている間、目を引く動きを繰り返します。</li>
  <li><b>表示範囲</b>で、このクリップだけか、同じマーカー・シーン・動画のすべてのクリップに出すかを選べます。</li>
</ul>

<h2 id="slow">スローと停止</h2>
<p>クリップを選んで<span class="ui">編集</span>タブを開き、見せたい場面で<span class="ui">＋ スロー</span>か<span class="ui">＋ 停止</span>を押します。スローは再生位置から 1 秒を 0.5 倍で流し、停止はその場面を 2 秒止めます。範囲・速さ・秒数は、その下の欄で変えられます。止めている間に図形を出すと、説明の時間が取れます。</p>

<h2 id="cards">タイトルカード</h2>
''' + site_shot('ja/finish-card.jpg', 'マーカーの頭のタイトルカード。マーカーの名前と、試合の相手・日付が出ます。') + '''
<p>動画の頭、シーンの頭、マーカーの頭に、名前を書いたタイトルカードが入ります。出すかどうかは、それぞれの<span class="ui">カード</span>で切り替えます。⚙ でカードを開くと、文字、タイトルの位置と大きさ、図形（チームのロゴも図形として入れます）を編集できます。<span class="ui">ほかのカードにも揃える…</span>で、同じ配置をほかの種類のカードにも使えます。</p>

<h2 id="slides">スライドを入れる</h2>
<p>クリップの間に、説明のためのスライドを入れられます。シーンの行やマーカーの見出しを右クリックして選びます。</p>
<ul class="dots">
  <li><b>＋ 今の画面をスライドに</b>（編集タブ）：今の動画のコマを止めた画像を背景に、矢印などを描くスライドを作ります。</li>
  <li><b>無地のスライド</b>：タイトルカードの色の無地に、文字や図形で説明を書きます。</li>
  <li><b>PDF・画像を読み込む…</b>：PowerPoint から PDF で書き出したものなどを、1 ページずつスライドにします。直した PDF は読み直せます。</li>
</ul>

<h2 id="palette">パレット</h2>
<p>よく使う図形の組み合わせ（矢印と円、チームのロゴなど）を選んで<span class="ui">選択を保存</span>すると、右下のパレットに残ります。ほかのプロジェクトでも、押すだけで置けます。</p>
'''

BODY['07-court.html'] = '''
<h1>7. コートの表示</h1>
<p class="m-lead">コートのグリッドを合わせた試合では、スカウトファイルの位置の情報を動画のコートの上に描けます。設定は動画の下の<span class="ui">表示</span>タブにまとまっています。</p>
''' + shot('view-tab', '「表示」タブ。上から、選んだ 1 本、着弾のあと、選手の全本数です。コートの準備は一番下に畳んであります。', narrow=True) + '''
<h2 id="prepare">コートの準備</h2>
<p>タブの一番下に畳んであり、押すと開きます。試合ごとに一度合わせれば、ふだんは開かなくてかまいません。四隅を合わせている間は開いたままです。</p>
<p>グリッドの四隅と<b>手前のチーム（第 1 セット）</b>を合わせます（<a href="03-project.html#court">3 章</a>）。<b>グリッドを出す</b>でグリッドを表示し、コート全体・上半分・下半分から出す範囲を選べます。⚙ でグリッドの色・濃さ・線の太さを変えます。</p>

<h2 id="one">選んだ 1 本</h2>
<p>プレー一覧やシーンで選んだプレーについて、動画の上に出すものです。</p>
<ul class="dots">
  <li><b>ゾーン</b>：始まりのゾーンを緑、終わりのゾーンを赤で塗り、矢印で結びます。サブゾーンや、スカウトが打った点の位置でも出せます。</li>
  <li><b>着弾の演出</b>：サーブやアタックが落ちる場所に、光の輪が広がるなどの効果を出します。始まりの秒数を、動画のボールに合わせて調整します。</li>
  <li><b>着弾のあと</b>：<b>結果アイコン</b>で、落ちたあとに結果のアイコン（エース・決定は星、ミスはバツ、ブロックは盾）を出します。<b>色分け</b>で、軌道を結果の色に変えます。</li>
</ul>
''' + site_shot('court-zone.jpg', 'アタックの始まりのゾーン（緑）と終わりのゾーン（赤）を矢印で結んだ表示。') + site_shot('court-flight.jpg', '打点の高さから落ちた位置までのアタックの軌道。') + '''
<h2 id="all">選手の全本数</h2>
<p>サーブかアタックかセットを選んだとき、その選手の全試合のプレーを重ねて出します。サーブ・アタック・セットのタブごとに設定を覚えます。<b>対象</b>で、全試合か、この試合・シーン・マーカー・ラリーだけかを選びます。</p>
<div class="m-scroll"><table class="m-table">
  <thead><tr><th>表示</th><th>中身</th></tr></thead>
  <tbody>
    <tr><td>ヒートマップ</td><td>その選手の打った先を色の濃さで出します。コートを押すと、近い 5 本が一覧に出ます。</td></tr>
    <tr><td>サーブ軌道</td><td>選んだサーブと一緒に、その選手のサーブを全部飛ばします。</td></tr>
    <tr><td>落下点</td><td>落ちた位置を点で出します。点を押すと、そのプレーへ移ります。</td></tr>
    <tr><td>コーン</td><td>アタッカーの打った位置から 5 方向の扇形を広げ、それぞれの割合を出します。</td></tr>
    <tr><td>チャート</td><td>その選手のコース図を、結果の色で動画の隅に出します。</td></tr>
    <tr><td>セット配分・トスのチャート</td><td>セットかその次のアタックを選んだとき、そのセッターのそのローテーションでのトスの行き先を、コートの上やチャートで出します。</td></tr>
  </tbody>
</table></div>
''' + site_shot('court-serve.jpg', '1 人の選手のサーブの軌道と、落下点のヒートマップ。') + site_shot('court-cones.jpg', 'アタッカーの打った位置から広がる 5 つのコーンと、それぞれの割合。') + '''
<h2 id="auto">自動表示</h2>
<p>タブの一番下で、すべてのクリップに自動で出すものを選びます。</p>
<ul class="dots">
  <li><b>スコアボード</b>：そのラリーの前の得点とセット数です。左が自チームです。</li>
  <li><b>テロップ</b>：プレーした選手の背番号・名前・スキル・評価です。名前は、この動画だけ、このクリップだけの書き換えもできます。</li>
  <li><b>分析表示</b>：上の「選んだ 1 本」「選手の全本数」の表示を、そのクリップに出すかどうかです。</li>
  <li><b>サーブ速度</b>：<span class="ui">編集</span>タブでサーブを打ったコマ（ヒット）とレシーブが触れたコマ（タッチ）を付けると、その間の平均の速さ（km/h）を出します。</li>
  <li><b>ローテーション</b>：両チームのコート上の 6 人を、小さなコートに背番号で出します。動画の手前にいるチームが下に出ます。</li>
</ul>
<p>表示タブで決めるのは「出すかどうか」です。位置・大きさ・デザイン・配色は、表示タブの<span class="ui">見た目は「動画の設定」</span>から開く<span class="ui">動画の設定</span>で変えます（<a href="10-export.html">10 章</a>）。動画の上に見えているものは、そのまま書き出しにも入ります。</p>
<p>表示タブの設定は動画ごとに保存されます。動画を開いていないときの設定は、このパソコンに保存されます。まだ表示タブを変えていない動画は、その設定で表示されます。</p>
'''

BODY['08-data.html'] = '''
<h1>8. データスライドとレポート</h1>
<p class="m-lead">動画だけでなく、数字の資料もプロジェクトの試合から作れます。データスライドは動画の中に入れられ、PNG・PDF・PowerPoint にも書き出せます。</p>

<h2 id="slides">データスライド</h2>
<p>上の<span class="ui">データスライド作成</span>を押し、種類とチーム、選手を選んで<span class="ui">作成</span>を押します。できたスライドは、選んだマーカーの中か、シーンの頭のタイトルカードとして入ります。</p>
''' + shot('board', '「データスライド」の画面。サーブで 3 人を選んだところ。下に仕上がりの見本が出ます。') + '''
<div class="m-scroll"><table class="m-table">
  <thead><tr><th>種類</th><th>中身</th></tr></thead>
  <tbody>
    <tr><td>サーブ・アタック</td><td>選手ごとのコースのチャートと、ブレイク率・ミス率・決定率などです。</td></tr>
    <tr><td>セット</td><td>レセプションの質とセッターコールごとの、トスの行き先の割合です。ローテーション別のサイドアウトにもできます。</td></tr>
    <tr><td>ローテーション</td><td>ローテーションごとに 1 枚。フォーメーション、主なアタッカーのコーン、攻撃の割合の表です。</td></tr>
    <tr><td>チーム比較</td><td>2 つのプロジェクトのチームを、サイドアウト・ブレイク・アタック・サーブ・レセプションなどで並べます。並べる数字は選べます。</td></tr>
    <tr><td>個人スタッツ</td><td>選手ごとのサーブ・アタック・レセプションの基本の数字の表です。</td></tr>
  </tbody>
</table></div>
''' + site_shot('slide-rotation.jpg', 'ローテーションのスライド。') + site_shot('slide-setter.jpg', 'セッターのスライド。レセプションの質とセッターコールごとのセット配分。') + '''
<p>写真は、選手写真のパック（右下の<span class="ui">選手写真</span>）から入ります。スライドの文字や写真はあとから動かせ、矢印や図形も足せます。</p>

<h2 id="preset">プリセットから作る</h2>
''' + site_shot('ja/preset.jpg', '「プリセットから作る」。サイドアウトの動画を、レセプションの質で分けて作るところ。', narrow=True) + '''
<p>上の<span class="ui">プリセットから作る</span>で、決まった型の動画をまとめて作れます。サイドアウト、サーブ、ブロック、アタックから選び、ローテーション別・選手別・ゾーン別・結果別などの分け方を選ぶと、シーンとマーカーに分かれた新しい動画ができます。試合が増えたら<span class="ui">作り直す</span>で、同じ型のまま作り直せます。</p>

<h2 id="report">マッチレポート</h2>
''' + site_shot('ja/report-team.jpg', '4 試合を合わせたチームのレポート。') + '''
<p>上の<span class="ui">マッチレポート</span>で、1 試合か全試合の合計を A4 1 枚のレポートにします。選手ごとの得点・サーブ・レセプション・アタックと、チームの合計が並びます。<b>数字を押すと、そのプレーだけがプレー一覧に出ます</b>。PDF でも保存できます。</p>

<h2 id="analysis">分析</h2>
''' + site_shot('ja/analysis-rotation.jpg', '分析のローテーションのタブ。') + '''
<p>上の<span class="ui">分析</span>で、対象チームの数字を表で見られます。サイドアウト・ブレイク、レセプションと攻撃、ローテーション、連続得点・連続失点のタブがあります。</p>
'''

BODY['09-compare.html'] = '''
<h1>9. 比較動画</h1>
<p class="m-lead">2 本の動画を左右や上下に並べ、同じ瞬間に合わせて見比べます。フォームの違いや、別の試合での同じ場面を比べるのに使います。プロジェクトとは別の画面で、DVW のない動画も使えます。</p>
''' + shot('compare', '2 試合のアタックを左右に並べ、打った瞬間で同期したところ。') + '''
<h2 id="new">比較を作る</h2>
<ol class="m-steps">
  <li>ホーム右上の<span class="ui">比較動画 ▾</span>から<span class="ui">新しい比較を作る</span>を押します。</li>
  <li>左と右それぞれの<span class="ui">動画を選ぶ ▾</span>で、倉庫の試合を選びます。DVW のない動画は<span class="ui">ファイルから選ぶ…</span>で選びます。</li>
  <li>倉庫の試合なら、<span class="ui">プレー ▾</span>で見たいプレーを選ぶと、その場面に移ります。</li>
  <li>両方を同じ瞬間（サーブを打った瞬間など）に合わせ、<span class="ui">いまの位置で同期</span>を押します。</li>
</ol>
<p>同期すると、<span class="ui">両方再生</span>（<kbd>Space</kbd>）で左右が一緒に動きます。ずれは <span class="ui">−1f</span> <span class="ui">+1f</span> で 1 コマずつ直せます。それぞれの ▶ は、その側だけを再生します。操作している側には青い枠が付きます。</p>

<h2 id="layout">並べ方と拡大</h2>
<ul class="dots">
  <li><b>左右</b>・<b>上下</b>・<b>重ねる</b>から選びます。重ねるでは、<b>重ね具合</b>のスライダーで右の動画の透け方を変えます。</li>
  <li>動画の上でホイールを回すと拡大、ドラッグで移動します。<b>拡大を連動</b>にすると、片方の拡大がもう片方にも同じだけ効きます。</li>
  <li><span class="ui">コートで縮尺を合わせる</span>は、両方ともコートのグリッドを合わせた倉庫の試合のとき、2 つのコートの四隅が重なるように拡大と位置を合わせます。</li>
</ul>

<h2 id="save">保存と書き出し</h2>
<p>比較は自動で保存され、<span class="ui">比較動画 ▾</span>の一覧から開き直せます。一覧には名前が出るので、画面の上の欄で名前を付けておくと見分けやすくなります。<span class="ui">MP4に書き出し</span>で、今の位置の前後（前・後の秒数）を、見えている拡大のまま 1 本の MP4 にします。音声は入りません。</p>
'''

BODY['10-export.html'] = '''
<h1>10. 書き出しの詳細</h1>
<p class="m-lead">MP4 の見た目を決める「動画の設定」と、書き出せる範囲、スライドやレポートの書き出し方です。書き出しにはログイン（お試し中か契約中）が必要です。</p>

<h2 id="settings">動画の設定</h2>
<p>右上の動画の名前の横にある ⚙ か、書き出しタブの<span class="ui">動画の設定</span>で開きます。動画ごとの設定で、左に見本が出ます。</p>
''' + shot('video-settings', '「動画の設定」。デザインを 4 つから選び、スコアボード・テロップ・サーブ速度・ローテーションの位置と大きさを決めます。') + '''
<div class="m-scroll"><table class="m-table">
  <thead><tr><th>項目</th><th>中身</th></tr></thead>
  <tbody>
    <tr><td>配色</td><td>スコアボード・テロップ・タイトルカードの色です。プロジェクトのすべての動画に共通です。</td></tr>
    <tr><td>デザイン</td><td>スラント・ボックス・ライト・フロートの 4 つです。</td></tr>
    <tr><td>スコアボード</td><td>出すかどうか、位置、大きさ、セット数を出すかどうかです。</td></tr>
    <tr><td>選手テロップ</td><td>位置、大きさと、背番号・名前・スキル・評価・統計・写真のどれを出すかです。</td></tr>
    <tr><td>サーブ速度・ローテーション</td><td>位置と大きさです（<a href="07-court.html#auto">7 章</a>）。</td></tr>
    <tr><td>タイトルカード</td><td>動画の頭・シーンの頭・マーカーの頭に出すかどうかと、秒数です。</td></tr>
    <tr><td>フェード</td><td>クリップとカードの切り替わりをフェードにするかどうかと、その秒数です。</td></tr>
  </tbody>
</table></div>

<h2 id="range">書き出す範囲</h2>
<p>右の<span class="ui">書き出し</span>タブで選びます（<a href="05-scene.html#export">5 章</a>）。</p>
<ul class="dots">
  <li><b>すべて書き出し</b>：動画全体を 1 本の MP4 にします。</li>
  <li><b>シーンごとに書き出し</b>：シーンごとに、シーンの名前のファイルにします。保存先のフォルダを選ぶと順に書き出します。</li>
  <li><b>シーンだけ・マーカーだけ</b>：1 つのシーンか、1 つのマーカーだけを書き出します。</li>
  <li><b>このクリップだけ</b>：シーンのクリップを右クリックして<span class="ui">このクリップだけ書き出す…</span>を選びます。タイトルカードは入りません。</li>
</ul>
<p>同じ名前のファイルがあるときは、上書きしてよいか聞きます。書き出しの途中でキャンセルもできます。</p>

<h2 id="quality">画質</h2>
<p>ふだんは 720p で書き出します。書き出す動画に使っている試合の動画が<b>すべて 1080p 以上のときだけ</b>、書き出しタブに<b>画質</b>の 720p・1080p の切り替えが出ます。元の動画が 720p なら、1080p にしてもきれいにはならないためです。1080p はファイルが大きくなり、書き出しにも時間がかかります。</p>

<h2 id="youtube">YouTube のチャプター</h2>
<p><b>YouTube のチャプターも書き出す</b>にすると、シーンの始まりの時刻を並べたテキストファイル（.txt）が MP4 の横にできます。YouTube の説明欄に貼るとチャプターになります。YouTube は、チャプターが 3 つ以上あり、それぞれ 10 秒以上のときだけチャプターを出します。</p>

<h2 id="slides">スライドとカードの書き出し</h2>
<p>スライドかタイトルカードを開くと、書き出しのボタンが出ます。</p>
<ul class="dots">
  <li><span class="ui">PNG に書き出す…</span>：開いているスライドを画像にします。</li>
  <li><span class="ui">PDF に書き出す…</span>：そのシーンのカードとスライドを、順に 1 つの PDF にします。</li>
  <li><span class="ui">PowerPoint に書き出す…</span>：そのシーンのスライドから選んで、1 つの PowerPoint ファイルにします。図形を PowerPoint で動かせる形のまま入れることもできます。</li>
</ul>
<p>マッチレポートは、レポートの画面から PDF で保存します（<a href="08-data.html#report">8 章</a>）。</p>
'''

BODY['11-help.html'] = '''
<h1>11. 困ったとき</h1>
<p class="m-lead">よくある困りごとと、その直し方です。解決しないときは、下のお問い合わせ先までご連絡ください。</p>

<h2 id="files">動画や DVW が見つからない</h2>
<p>動画や DVW のファイルを移したり、名前を変えたり、外付けのドライブを外したりすると、倉庫から見つからなくなります。見つからないファイルの横に出る<span class="ui">場所を指定…</span>で、今の場所を選び直してください。取り込み直す必要はありません。</p>

<h2 id="timing">クリップの場面がずれている</h2>
<p>クリップは DVW に記録された時刻で切り出します。試合全体が同じだけずれているときは、アプリで直せます。</p>
<ol class="m-steps">
  <li>プレー一覧でサーブを 1 つ選び、動画の下の<span class="ui">編集</span>タブを開きます。</li>
  <li>動画をそのサーブを打った瞬間に合わせます（<kbd>Shift</kbd> + <kbd>←</kbd> <kbd>→</kbd> で 1 コマずつ）。</li>
  <li><b>時刻合わせ</b>の<span class="ui">◎ ここをこのプレーの時刻にする</span>を押します。この試合のすべてのプレーが同じだけ動きます。</li>
</ol>
<p><span class="ui">−0.5秒</span> <span class="ui">+0.5秒</span> で少しずつ直すことも、<span class="ui">ずれを 0 に戻す</span>で元に戻すこともできます。試合の途中からずれ方が変わるときは、DataVolley や VolleyStation で動画との時刻合わせを直した DVW を、<span class="ui">場所を指定…</span>から読み直してください。1 本だけ少しずれるときは、そのクリップの IN・OUT を直します。</p>

<h2 id="court">コートの表示がずれる</h2>
<p>グリッドの四隅がコートの角に合っていないか、手前のチームが違っています。<span class="ui">表示</span>タブの一番下の「コートの準備」を開いて、四隅と<b>手前のチーム（第 1 セット）</b>を直してください（<a href="03-project.html#court">3 章</a>）。カメラが試合の途中で動いた動画では、合わない場面が出ます。</p>

<h2 id="play">動画が再生できない・取り込みに時間がかかる</h2>
<p>そのままでは再生できない形式の動画は、取り込みのときに再生できる形式に変換します。長い動画では数分かかることがあります。</p>

<h2 id="export">書き出しや取り込みができない</h2>
<ul class="dots">
  <li><b>ログインしていない</b>：書き出しと 2 試合目からの取り込みにはログインが必要です（<a href="01-start.html#login">1 章</a>）。</li>
  <li><b>お試しや契約が終わった</b>：ログインの画面の<span class="ui">契約を確認</span>から契約できます。作ったプロジェクトは開いて編集できます。</li>
  <li><b>更新の支払いが済んでいない</b>：ログインの画面に出る<span class="ui">未払いの請求を支払う</span>から、Stripe の請求書のページで支払うと、すぐ使えるようになります。</li>
  <li><b>長くインターネットにつないでいない</b>：ログインの確認は 30 日まで有効です。一度つないでアプリを開いてください。</li>
  <li><b>確認コードが届かない</b>：迷惑メールのフォルダを見て、それでもなければ<span class="ui">もう一度送る</span>を押します。</li>
</ul>

<h2 id="cancel">解約したい</h2>
<p>有料プランの解約は、チームの管理者か、支払いをしている人がアプリから行います。SyncScout Web の管理者ページからもできます。</p>
<ol class="m-steps">
  <li>ホーム画面の右上のアカウント（メールアドレス）を押して、ログインの画面を開きます。</li>
  <li><span class="ui">契約の管理・解約</span>を押します。ブラウザで Stripe のページが開きます。</li>
  <li>Stripe のページで、解約（キャンセル）を選びます。カードの変更や請求書の確認もここでできます。</li>
</ol>
<ul class="dots">
  <li>解約しても、お支払い済みの期間の終わりまでは使えます。期間の終わりまでなら、同じページで解約を取り消せます。</li>
  <li>作ったプロジェクトと書き出した動画は、パソコンに残ります。契約が終わったあとも、プロジェクトを開いて編集できます（<a href="01-start.html#login">1 章</a>）。</li>
  <li><span class="ui">契約の管理・解約</span>が出るのは、有料プランを契約中か、更新の支払いが済んでいないときです。お試し中は、何もしなければ自動で課金されないので解約はいりません。</li>
  <li>押せば開くのは、チームの管理者と、支払いをしている人（ログインしたメールアドレスが、支払いに使ったアドレスかチームの連絡先のアドレス）です。管理者パスコードでチームに参加した人と、アプリでお試しを始めた人が管理者です。</li>
  <li>パスコード（選手・スタッフの閲覧用）で参加した人が押すと、管理者パスコードを入れる欄が出ます。正しく入れると、そのチームの管理者になって Stripe のページが開きます。わからないときは、チームの管理者に依頼してください。</li>
  <li>支払いをした人は、決済を代行している Stripe の Link のサイトからも解約できます。</li>
</ul>

<h2 id="update">更新できない</h2>
<p>Windows で更新に失敗すると、<span class="ui">ダウンロードページを開く</span>が出ます。そこから新しい版を入れ直してください。セキュリティソフトが止めていることもあります。原因を探すための記録（update.log）は<span class="ui">記録を見る</span>で開けるので、お問い合わせのときに添えてください。Mac は自動では更新されないので、製品サイトから新しい版を入れ替えます。</p>

<h2 id="data">データの置き場所</h2>
<ul class="dots">
  <li>動画と DVW は、取り込んだもとの場所のままです。アプリがコピーや移動をすることはありません。</li>
  <li>倉庫のフォルダに、試合の一覧、コートのグリッド、プロジェクト（projects フォルダ）が入っています。別のパソコンへ移すときは、倉庫のフォルダごと移し、<span class="ui">倉庫を変更</span>で選びます。動画と DVW の場所が変わるときは、<span class="ui">場所を指定…</span>で選び直します。</li>
  <li>削除したシーンや動画、倉庫から外した試合は、それぞれのフォルダの deleted に移るだけで、すぐには消えません。</li>
</ul>

<h2 id="contact">お問い合わせ</h2>
<p><a href="mailto:syncscout@courtend.net">syncscout@courtend.net</a> までメールでご連絡ください。アプリのバージョン（画面左上の v0.2.40 など）、Windows か Mac か、起きたことと、そのときの画面の写真があると早く調べられます。</p>
'''

os.makedirs(OUT, exist_ok=True)
for f, title, desc in CH:
    with open(OUT + f, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(page(f, title, desc, BODY[f]))
    print('wrote', f)
