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
]
SOON = ['動画に描く', 'コートの表示', 'データスライドとレポート', '比較動画', '書き出しの詳細', '困ったとき']

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

def shot(name, cap, narrow=False, alt=None):
    cls = 'm-shot narrow' if narrow else 'm-shot'
    return f'<figure class="{cls}"><img src="../img/ja/{name}.jpg" alt="{alt or cap}" loading="lazy"><figcaption>{cap}</figcaption></figure>'

BODY = {}

BODY['index.html'] = '''
<h1>SyncScout Video Editor マニュアル</h1>
<p class="m-lead">DataVolley や VolleyStation のスカウトファイルと試合動画から、ミーティング用の映像を作るまでの手順です。上から順に読むと、最初の動画を書き出すところまで進めます。</p>
<ol class="m-cards">
  <li><a href="01-start.html"><b><i>1</i>はじめに</b><span>インストール、ログインと 30 日のお試し、アプリの中の言葉</span></a></li>
  <li><a href="02-import.html"><b><i>2</i>試合を取り込む</b><span>倉庫を決めて、動画と DVW を組にして入れる</span></a></li>
  <li><a href="03-project.html"><b><i>3</i>プロジェクトを作る</b><span>分析するチームを選び、コートのグリッドを確かめる</span></a></li>
  <li><a href="04-find.html"><b><i>4</i>プレーを探す</b><span>プレー一覧の見方と、チーム・選手・スキル・評価での絞り込み</span></a></li>
  <li><a href="05-scene.html"><b><i>5</i>シーンと動画を作る</b><span>プレーをマーカーで分けて並べ、MP4 に書き出す</span></a></li>
  <li><span class="soon"><b><i>6</i>動画に描く</b><span>図形とテキスト、出す時間、スロー・静止、タイトルカード（準備中）</span></span></li>
  <li><span class="soon"><b><i>7</i>コートの表示</b><span>ゾーン、軌道、ヒートマップ、トス配分、ローテーション（準備中）</span></span></li>
  <li><span class="soon"><b><i>8</i>データスライドとレポート</b><span>データスライド、マッチレポート、分析（準備中）</span></span></li>
  <li><span class="soon"><b><i>9</i>比較動画</b><span>2 本の動画を並べて見比べる（準備中）</span></span></li>
  <li><span class="soon"><b><i>10</i>書き出しの詳細</b><span>MP4 の設定、YouTube チャプター、PNG・PDF・PowerPoint（準備中）</span></span></li>
  <li><span class="soon"><b><i>11</i>困ったとき</b><span>よくある質問、更新、ログイン（準備中）</span></span></li>
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

<h2 id="login">ログインと 30 日のお試し</h2>
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
      <li><b>初めて使う</b>：<span class="ui">無料お試しを始める</span>で自分のチームができ、30 日間すべて使えます。カードの登録はいりません。お試しが終わっても自動で課金はされません。</li>
      <li><b>SyncScout をすでに使っている</b>：チームの管理者から聞いたチーム ID と合言葉で参加します。チームの契約のまま使えます。</li>
    </ul>
  </li>
</ol>
''' + shot('login', 'ログインの画面。ログインなしでできることと、ログインが要ることが並んでいます。', narrow=True) + '''
<div class="m-note">
  <strong>お試しや契約が終わったら</strong>
  <p>試合の追加、新しいプロジェクト、書き出しができなくなります。作ったプロジェクトはそのまま開いて編集でき、パソコンの中のデータが消えることはありません。契約は<span class="ui">契約を確認</span>から始められます。</p>
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
  <li><b>DVW は、その動画と同期したものを使います。</b>クリップは DVW に記録された時刻で切り出します。DataVolley や VolleyStation で、動画との時刻合わせを済ませた DVW を使ってください。DVW の時刻が動画の長さを超えているときは、取り込みのときに知らせます。</li>
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
<p>自動で見つからなかったときや、あとで直したいときは、動画の下の<span class="ui">表示</span>タブの「コートの準備」から合わせ直せます。</p>

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
  <li>動画の上に見えているもの（コートのグリッド、ゾーン、チャート、トス配分など）は、そのまま書き出しにも入ります。</li>
  <li>画質（720p など）、フェード、タイトルカード、スコアボードの見た目は、<span class="ui">動画の設定</span>で変えます。</li>
  <li><b>YouTube のチャプターも書き出す</b>にすると、シーンの始まりを YouTube のチャプターにしたテキストファイルが MP4 の横にできます。</li>
  <li>書き出しにはログイン（お試し中か契約中）が必要です。</li>
</ul>
<div class="m-note">
  <p>ここまでで、最初の動画ができました。図形やテキストを足す方法、コートの上のデータの出し方は、6 章以降で順に足していきます。</p>
</div>
'''

os.makedirs(OUT, exist_ok=True)
for f, title, desc in CH:
    with open(OUT + f, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(page(f, title, desc, BODY[f]))
    print('wrote', f)
