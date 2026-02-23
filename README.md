# jimacraft

文字起こしテキストからSRT字幕ファイルを生成するWebツール。
動画の文字起こしから、Premiere Pro への字幕インポートまでをガイドします。

## できること

**準備ガイド** — 手元にあるもの（MP4 / MP3 / テキスト）に応じて、必要なステップだけを案内

- MP4→MP3変換（ffmpegコマンドガイド）
- 文字起こし用プロンプトの自動生成（Google AI Studio向け）

**字幕生成（3ステップ）**

1. **SRT変換** — 話者・タイムスタンプ付きテキストをSRT形式に変換
2. **マーカー編集** — `/` 分割 · `-` 結合 · `x` 削除の直感的な記法で字幕を調整
3. **話者別分割** — 話者ごとにSRTファイルを分離、個別ダウンロード

**Premiere Pro ガイド** — SRTインポートとプロパティパネルでのスタイル調整手順

## セットアップ

```bash
git clone https://github.com/your-username/jimacraft.git
cd jimacraft
npm install
```

## 起動

```bash
npm run subtitle
```

ブラウザで http://localhost:3002 を開く。

## 技術スタック

- フロントエンド: HTML + JavaScript
- バックエンド: Node.js + Express
- フォント: Space Grotesk（Google Fonts）

## ライセンス

MIT
