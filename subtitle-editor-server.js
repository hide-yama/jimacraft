/**
 * subtitle-editor-server.js
 * 字幕エディタWebアプリのExpressサーバー
 * - 3つのAPIエンドポイント（Step1〜3）
 * - HTML配信（ルートハンドラ経由）
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const { convertMdToSrt, processSrtEdits, splitBySpeaker } = require('./srt-processor');

const app = express();
const PORT = process.env.SUBTITLE_PORT || 3002;

// JSON body parser（5MB上限）
app.use(express.json({ limit: '5mb' }));

// キャッシュ無効化
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
});

// ==================== API エンドポイント ====================

// Step 1: MD形式テキスト → SRT変換
app.post('/api/step1/convert', (req, res) => {
    try {
        const { text } = req.body;
        if (!text || !text.trim()) {
            return res.status(400).json({ error: '文字起こしテキストが空です' });
        }
        const result = convertMdToSrt(text);
        res.json(result);
    } catch (err) {
        console.error('Step1エラー:', err);
        res.status(500).json({ error: '変換処理中にエラーが発生しました: ' + err.message });
    }
});

// Step 2: マーカー付きSRT → 編集処理
app.post('/api/step2/edit', (req, res) => {
    try {
        const { srt } = req.body;
        if (!srt || !srt.trim()) {
            return res.status(400).json({ error: 'SRTテキストが空です' });
        }
        const result = processSrtEdits(srt);
        res.json(result);
    } catch (err) {
        console.error('Step2エラー:', err);
        res.status(500).json({ error: '編集処理中にエラーが発生しました: ' + err.message });
    }
});

// Step 3: 編集済みSRT → 話者別分割
app.post('/api/step3/split', (req, res) => {
    try {
        const { srt } = req.body;
        if (!srt || !srt.trim()) {
            return res.status(400).json({ error: 'SRTテキストが空です' });
        }
        const result = splitBySpeaker(srt);
        res.json(result);
    } catch (err) {
        console.error('Step3エラー:', err);
        res.status(500).json({ error: '分割処理中にエラーが発生しました: ' + err.message });
    }
});

// ==================== HTML配信 ====================

// ルートでHTML配信（express.staticは使わない）
app.get('/', (req, res) => {
    const htmlPath = path.join(__dirname, 'subtitle-editor.html');
    fs.readFile(htmlPath, 'utf-8', (err, html) => {
        if (err) {
            console.error('HTML読み込みエラー:', err);
            return res.status(500).send('ページの読み込みに失敗しました');
        }
        res.type('html').send(html);
    });
});

// その他のルートは404
app.use((req, res) => {
    res.status(404).json({ error: 'Not Found' });
});

// ==================== サーバー起動 ====================

app.listen(PORT, () => {
    console.log(`字幕エディタサーバー起動: http://localhost:${PORT}`);
});
