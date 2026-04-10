/**
 * Gemini API 音声文字起こしテスト
 * 使い方: node geminiテスト/test-gemini-audio.js
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

const API_KEY = 'AIzaSyBrEhondgX7CRsrEvpyraH_lODTBX_EQEg';
const AUDIO_FILE = path.join(__dirname, '..', 'output.mp3');

async function transcribe() {
    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: { maxOutputTokens: 65536 }
    });

    console.log('音声ファイル読み込み中...');
    const audioData = fs.readFileSync(AUDIO_FILE);
    const base64Audio = audioData.toString('base64');
    console.log(`ファイルサイズ: ${(audioData.length / 1024 / 1024).toFixed(1)}MB`);

    const prompt = `以下の音声ファイルを文字起こししてください。

出力形式

各発言を以下の形式で厳密に出力してください：
話者名（性別）: [分:秒] 発言内容

- 話者名の後の括弧は性別（男性/女性/不特定）のみ。ニックネームや補足情報は括弧に入れないでください。
- 性別は必ず日本語（男性/女性/不特定）で記載してください。英語（male/female）は使わないでください。

既知の話者

- ゆのん（女性）→ 出力時: ゆのん（女性）
- おさき（女性）→ 出力時: おさき（女性）
- みみこ（女性）→ 出力時: みみこ（女性）
- ナレーター（女性）→ 出力時: ナレーター（女性）
- ディレクター（男性）→ 出力時: ディレクター（男性）

内容

占い番組でみみこさんにゆのんとおさきが占ってもらっている。
ゆのんとおさきの二人の声は似ているので内容でしっかり判断してほしい。
ゆのんの方がテンションが高い。
最初と最後にディレクターからのインタビューやナレーションが入ったりする。

ルール

タイムスタンプは [M:SS] 形式（例: [0:00], [1:30], [12:05]）
句読点を適切に使用してください
上記以外の話者が登場した場合は「話者A（不特定）」「話者B（不特定）」のように表記してください`;

    console.log('Gemini 2.5 Flash に送信中...');
    const startTime = Date.now();

    const result = await model.generateContent([
        { text: prompt },
        {
            inlineData: {
                mimeType: 'audio/mpeg',
                data: base64Audio
            }
        }
    ]);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`処理時間: ${elapsed}秒\n`);
    console.log('===== 文字起こし結果 =====\n');
    console.log(result.response.text());
}

transcribe().catch(err => {
    console.error('エラー:', err.message);
});
