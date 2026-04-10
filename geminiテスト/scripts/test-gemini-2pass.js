/**
 * Gemini API 2パス文字起こしテスト
 * 1回目: 音声の概要・文脈を把握
 * 2回目: 文脈情報を使って精度の高い文字起こし
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

    const audioContent = {
        inlineData: {
            mimeType: 'audio/mpeg',
            data: base64Audio
        }
    };

    // ==================== Step 1: 音声の概要把握 ====================
    console.log('\n===== Step 1: 音声の概要を把握中... =====\n');
    const step1Start = Date.now();

    const step1Prompt = `この音声を聞いて、以下の情報を整理してください。文字起こしはしないでください。

1. **番組/会話の種類**: どんな種類のコンテンツか（対談、インタビュー、講演、バラエティ等）
2. **登場人物**: 何人いるか、それぞれの名前（分かれば）、性別、役割（司会、ゲスト、ナレーター等）
3. **声の特徴**: 各話者の声の違い（高い/低い、テンション、話し方の癖など）
4. **全体の流れ**: どんな構成で進むか（導入→本編→まとめ等）
5. **話者が入れ替わるパターン**: 誰が主に話すパート、誰が相槌を打つか、等の傾向

できるだけ詳細に分析してください。`;

    const step1Result = await model.generateContent([
        { text: step1Prompt },
        audioContent
    ]);

    const context = step1Result.response.text();
    const step1Time = ((Date.now() - step1Start) / 1000).toFixed(1);
    console.log(`Step 1 処理時間: ${step1Time}秒\n`);
    console.log(context);
    console.log('\n===================================================\n');

    // ==================== Step 2: 文脈を使った文字起こし ====================
    console.log('===== Step 2: 文脈情報を使って文字起こし中... =====\n');
    const step2Start = Date.now();

    const step2Prompt = `以下の音声ファイルを文字起こししてください。

## この音声の文脈情報（事前分析結果）
${context}

## 出力形式（厳守）
1発言1行で、以下の形式で出力してください：
話者名（性別）: [M:SS] 発言内容

出力例：
ゆのん（女性）: [0:15] インフルエンサークリエイターやってます。
おさき（女性）: [0:20] YouTubeを中心にやってます。
ディレクター（男性）: [0:31] 占い、ご興味はありますか？

## 話者名のルール
- 話者名は実際の名前やニックネームを使ってください（「女性A」のような記号は使わない）
- 括弧内は性別のみ（男性/女性/不特定）。日本語のみ。
- 必ず毎行の先頭に「話者名（性別）:」を付けてください。省略しないでください。

## その他のルール
- タイムスタンプは [M:SS] 形式（例: [0:00], [1:30], [12:05]）
- 句読点を適切に使用してください
- 1つの発言に複数のタイムスタンプを入れないでください
- 上記の文脈情報を活用して、話者の取り違えがないよう注意してください`;

    const step2Result = await model.generateContent([
        { text: step2Prompt },
        audioContent
    ]);

    const step2Time = ((Date.now() - step2Start) / 1000).toFixed(1);
    console.log(`Step 2 処理時間: ${step2Time}秒`);
    console.log(`合計処理時間: ${(parseFloat(step1Time) + parseFloat(step2Time)).toFixed(1)}秒\n`);
    console.log('===== 文字起こし結果 =====\n');
    console.log(step2Result.response.text());
}

transcribe().catch(err => {
    console.error('エラー:', err.message);
});
