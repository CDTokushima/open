iPhone自転車ナビ v2.1（矢印の黒／青選択）

公開版 v2.0 からの変更点:
- 白背景の巨大な案内矢印を黒（初期値）または青から選択可能
- 地図画面に「案内矢印の色」の選択ボタンを追加
- iPhoneの localStorage に選択を保存（保存不可でも動作）
- GPS、ルーティング、移動判定、ゴール判定、Wake Lock、方位センサーは変更しない

導入方法:
1. ZIPを展開する。
2. GitHubの gh-pages ブランチに切り替える。
3. test/iphone_route_webapp/ に index.html、arrow-colors.css、arrow-colors.js をアップロードする。
   index.html は既存ファイルを上書きする。
   README_UPDATE.txt は配布用メモなので、GitHubへのアップロードは不要。
4. https://cdtokushima.github.io/open/test/iphone_route_webapp/ をiPhoneで開く。
5. 地図画面の「案内矢印の色」で黒／青を切り替える。

更新対象は上記3ファイルのみ。既存の app.js、nav-core.js、style.css 等はそのまま使う。
