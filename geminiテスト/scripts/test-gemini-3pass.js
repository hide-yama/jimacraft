/**
 * Gemini API 3パス文字起こしテスト
 * Step 1: ユーザー入力 + 音声 → 文脈分析
 * Step 2: 文脈分析 + 音声 → 文字起こし
 * Step 3: 文脈分析 + 文字起こし → 品質チェック
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

const API_KEY = 'AIzaSyBrEhondgX7CRsrEvpyraH_lODTBX_EQEg';
const AUDIO_FILE = path.join(__dirname, '..', 'output.mp3');

// ユーザーが入力する情報（アプリの準備ステップで入力される想定）
const USER_INPUT = {
    speakers: [
        { name: 'ゆのん', gender: '女性' },
        { name: 'おさき', gender: '女性' },
        { name: 'みみこ', gender: '女性' },
        { name: 'ナレーター', gender: '女性' },
        { name: 'ディレクター', gender: '男性' }
    ],
    description: '占い番組。みみこさんがおさきさんとゆのんさんを占っている。'
};

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

    const speakerList = USER_INPUT.speakers.map(s => `- ${s.name}（${s.gender}）`).join('\n');

    // ==================== Step 1: 文脈分析 ====================
    console.log('\n===== Step 1: 文脈分析 =====\n');
    const step1Start = Date.now();

    const step1Prompt = `この音声を聞いて、文字起こしの精度を上げるための文脈情報を整理してください。
文字起こし自体はしないでください。

## ユーザーからの事前情報
話者:
${speakerList}
内容: ${USER_INPUT.description}

## 分析してほしいこと
1. 各話者の声の特徴（高さ、テンション、話し方の癖）を具体的に
2. 番組の流れと構成（どの時間帯に誰が主に話しているか）
3. 話者の見分け方のポイント（特に似た声の話者がいる場合）
4. 各話者の役割と話すパターン（長く話す人、相槌が多い人等）

※ 話者名は必ず上記のユーザー事前情報の名前を使ってください。`;

    const step1Result = await model.generateContent([
        { text: step1Prompt },
        audioContent
    ]);

    const context = step1Result.response.text();
    const step1Time = ((Date.now() - step1Start) / 1000).toFixed(1);
    console.log(`処理時間: ${step1Time}秒\n`);
    console.log(context);
    console.log('\n--- ここでユーザーが文脈分析を確認・手直しできる ---\n');

    // ==================== Step 2: 文字起こし ====================
    console.log('===== Step 2: 文字起こし =====\n');
    const step2Start = Date.now();

    const step2Prompt = `以下の音声ファイルを文字起こししてください。

## この音声の文脈情報
${context}

## 出力形式（厳守）
1発言1行で、以下の形式で出力してください：
話者名（性別）: [M:SS] 発言内容

出力例：
ゆのん（女性）: [0:15] インフルエンサークリエイターやってます。
おさき（女性）: [0:20] YouTubeを中心にやってます。
ディレクター（男性）: [0:31] 占い、ご興味はありますか？

## 話者名のルール
- 以下の名前のみ使用してください：
${speakerList}
- 上記以外の話者が登場した場合は「話者A（不特定）」等にしてください
- 括弧内は性別のみ（男性/女性/不特定）
- 必ず毎行の先頭に「話者名（性別）:」を付けてください

## その他のルール
- タイムスタンプは [M:SS] 形式
- 句読点を適切に使用してください
- 1つの発言に複数のタイムスタンプを入れないでください
- 文脈情報を活用して話者の取り違えがないよう注意してください`;

    const step2Result = await model.generateContent([
        { text: step2Prompt },
        audioContent
    ]);

    const transcription = step2Result.response.text();
    const step2Time = ((Date.now() - step2Start) / 1000).toFixed(1);
    console.log(`処理時間: ${step2Time}秒\n`);

    // ==================== Step 3: 品質チェック ====================
    console.log('===== Step 3: 品質チェック =====\n');
    const step3Start = Date.now();

    const step3Prompt = `以下の文字起こし結果を、文脈情報と照らし合わせて品質チェックしてください。

## 文脈情報
${context}

## 文字起こし結果
${transcription}

## チェック項目
1. **話者の取り違え**: 文脈上、別の人の発言ではないかと疑われる箇所を具体的に指摘してください（行の内容とタイムスタンプを引用）
2. **文脈の矛盾**: ある話者が自分の体験を語っているのに、途中で別の話者に切り替わっている箇所
3. **フォーマットの問題**: 形式が崩れている行（話者名がない、タイムスタンプがない等）
4. **その他の問題**: 不自然な文、意味不明な箇所

問題がない場合は「品質チェック: 問題なし」と出力してください。
問題がある場合は、各問題について「問題のある行」「理由」「修正案」を示してください。

## 重要な制約
- 修正できるのは「話者名」のみです。発言内容のテキストは一切変更しないでください。
- 音声から書き起こされた表現をそのまま維持してください。推測で言い換えたり、補足を追加したりしないでください。
- 修正案では、話者名だけを差し替えた行をそのまま出力してください。`;

    const step3Result = await model.generateContent([
        { text: step3Prompt }
    ]);

    const qualityCheck = step3Result.response.text();
    const step3Time = ((Date.now() - step3Start) / 1000).toFixed(1);
    console.log(`処理時間: ${step3Time}秒\n`);
    console.log(qualityCheck);

    // ==================== Step 4: 修正適用 ====================
    console.log('\n===== Step 4: 修正適用 =====\n');
    const step4Start = Date.now();

    const step4Prompt = `以下の文字起こし結果に、品質チェックの指摘内容を反映して修正版を出力してください。

## 文字起こし結果（原文）
${transcription}

## 品質チェックの指摘
${qualityCheck}

## 修正ルール（厳守）
- 品質チェックで指摘された「話者名の取り違え」のみ修正してください
- 発言内容のテキストは一文字たりとも変更しないでください
- 指摘されていない行はそのまま出力してください
- フォーマット（話者名（性別）: [M:SS] 発言内容）を維持してください
- 全行を省略せず出力してください`;

    const step4Result = await model.generateContent([
        { text: step4Prompt }
    ]);

    const corrected = step4Result.response.text();
    const step4Time = ((Date.now() - step4Start) / 1000).toFixed(1);
    console.log(`処理時間: ${step4Time}秒\n`);

    // ==================== 結果出力 ====================
    const totalTime = (parseFloat(step1Time) + parseFloat(step2Time) + parseFloat(step3Time) + parseFloat(step4Time)).toFixed(1);
    console.log(`\n===== 処理時間まとめ =====`);
    console.log(`Step 1（文脈分析）: ${step1Time}秒`);
    console.log(`Step 2（文字起こし）: ${step2Time}秒`);
    console.log(`Step 3（品質チェック）: ${step3Time}秒`);
    console.log(`Step 4（修正適用）: ${step4Time}秒`);
    console.log(`合計: ${totalTime}秒`);

    // ファイル保存
    fs.writeFileSync(path.join(__dirname, '..', 'results', '結果7_transcription.txt'), transcription, 'utf-8');
    fs.writeFileSync(path.join(__dirname, '..', 'results', '結果7_corrected.txt'), corrected, 'utf-8');
    console.log('\n文字起こし結果（修正前）を 結果7_transcription.txt に保存しました。');
    console.log('修正済み結果を 結果7_corrected.txt に保存しました。');
}

transcribe().catch(err => {
    console.error('エラー:', err.message);
});
