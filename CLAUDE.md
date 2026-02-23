# jimacraft

文字起こしテキストからSRT字幕ファイルを生成するWebアプリケーション。

## 技術スタック

- フロントエンド: HTML + JavaScript
- バックエンド: Node.js + Express
- 文字起こし: OpenAI Whisper API（MP3→テキスト用）

## ファイル構成

```
subtitle-editor.html           メインUI（jimacraft）
subtitle-editor-server.js      字幕エディタ用サーバー
srt-processor.js               SRT変換・編集・話者分割ロジック
mp4_to_mp3_with_transcription.html  MP4→MP3変換 + 文字起こしUI
transcription-server.js        変換・文字起こしサーバー
package.json                   依存管理
.env.example                   環境変数テンプレート
```

## 起動方法

```bash
# 字幕エディタ（jimacraft）
npm run subtitle    # → http://localhost:3002

# MP4→MP3変換 + 文字起こし
npm start           # → http://localhost:3000
```

## jimacraft の機能

### 準備ガイド
ユーザーの状態に応じてガイドを表示:
- MP4 → ffmpeg変換ガイド → 文字起こしプロンプト生成 → Step 1
- MP3 → 文字起こしプロンプト生成 → Step 1
- テキスト → 直接 Step 1

### Step 1: 文字起こし → SRT変換
話者・タイムスタンプ付きテキストをSRT形式に変換

### Step 2: マーカー編集
- `/` 分割、`-` 結合、`x` 削除
- 処理順: 削除 → 結合 → 分割

### Step 3: 話者別分割
SRTを話者ごとに分離、個別ダウンロード

### Premiere Pro インポートガイド
SRTファイルの読み込み手順とプロパティパネルでのスタイル調整方法

## デザイン方針

- 配色: 白・黒・グレーのみ（カラーなし）
- シャドウ: 控えめ
- アイコン: SVG線画（絵文字は使わない）
- タイトルフォント: Space Grotesk（Google Fonts）
- プレースホルダー等の人名: 架空の名前を使用

## 環境変数（.env）

```
OPENAI_API_KEY=your_key_here
PORT=3001
```
