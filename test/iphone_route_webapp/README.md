# かんたんルートナビ

HTML + JavaScript + Leaflet + OpenStreetMap で動くサンプルです。

## 機能

1. iPhoneの現在地を取得
2. OpenStreetMap上に現在地を表示
3. 地図をタップして目的地を指定
4. ルートを地図上に表示
5. Apple Mapsを開いて徒歩ナビを開始

## ファイル

- `index.html`
- `style.css`
- `app.js`

## 起動方法

位置情報APIは原則として HTTPS または localhost でのみ利用できます。

### PCで試す

Pythonがインストールされている場合、このフォルダで次を実行してください。

```bash
python3 -m http.server 8000
```

その後、

http://localhost:8000

を開きます。

### iPhoneで試す

もっとも簡単なのは、GitHub Pages、Netlify、Cloudflare PagesなどHTTPS対応のWebサーバーに
3ファイルをアップロードしてSafariで開く方法です。

Safariから位置情報利用の許可を求められたら「許可」を選びます。

## 注意

このサンプルの地図タイルは OpenStreetMap、
ルート検索は OSRM 公開デモサーバーを使います。

OSRM公開デモは試作用です。
また、このサンプルではOSRM公開デモの制約により、
Web画面上のルート計算は自動車ルートを使用しています。

Apple Mapsを開くボタンでは `dirflg=w` を指定しているため、
Apple Maps側では徒歩経路として案内されます。

本当に徒歩専用ルートをWeb画面内で計算したい場合は、
OpenRouteService、Mapbox Directions API、Google Routes APIなどに差し替えます。
