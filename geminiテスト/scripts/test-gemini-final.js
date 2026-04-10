/**
 * Gemini API 3ステップ文字起こし（最終版）
 * Step 1: ユーザー入力 + 音声 → 文脈分析
 * Step 2: 文脈分析 + 音声 → 文字起こし
 * Step 3: 文脈分析 + 文字起こし → 品質チェック（指摘のみ、自動修正なし）
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

const API_KEY = 'AIzaSyBrEhondgX7CRsrEvpyraH_lODTBX_EQEg';
const AUDIO_FILE = path.join(__dirname, '..', 'output.mp3');
const MODEL = 'gemini-2.5-pro';

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
        model: MODEL,
        generationConfig: { maxOutputTokens: 65536 }
    });

    console.log(`モデル: ${MODEL}`);
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
    const speakerNames = USER_INPUT.speakers.map(s => s.name).join('、');

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
5. 番組内で特定の話者が主役になるパート（例: Aさんが占われているパート、Bさんのインタビューパート等）があれば、その時間帯と主役の話者

※ 話者名は必ず上記のユーザー事前情報の名前（${speakerNames}）を使ってください。それ以外の呼び方（女性A等）は使わないでください。`;

    const step1Result = await model.generateContent([
        { text: step1Prompt },
        audioContent
    ]);

    const context = step1Result.response.text();
    const step1Time = ((Date.now() - step1Start) / 1000).toFixed(1);
    console.log(`処理時間: ${step1Time}秒\n`);
    console.log(context);
    const prefix = `結果_${MODEL}`;
    fs.writeFileSync(path.join(__dirname, '..', 'results', `${prefix}_step1_context.txt`), context, 'utf-8');
    console.log(`→ ${prefix}_step1_context.txt に保存\n`);
    console.log('--- ここでユーザーが文脈分析を確認・手直しできる ---\n');

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
太郎（男性）: [0:15] こんにちは。
花子（女性）: [0:20] よろしくお願いします。

## 話者名のルール
- 以下の名前を正確にコピーして使用してください（1文字でも変えない）：
${speakerList}
- 上記以外の話者が登場した場合は「話者A（不特定）」「話者B（不特定）」等にしてください
- 括弧内は性別のみ（男性/女性/不特定）。日本語のみ使用。
- 必ず毎行の先頭に「話者名（性別）:」を付けてください。省略しないでください。
- 話者名にローマ字、キリル文字、その他の非日本語文字を混入させないでください。

## 話者判定のルール
- ある話者が自分自身の体験・思い出・意見を語り始めたら、その話題が終わるまで同じ話者が続く可能性が非常に高いです。途中で別の話者に切り替えないよう注意してください。
- 特に、文脈情報で「特定の話者が主役のパート」が示されている場合、そのパートでは主役の話者の発言が多くなります。主役でない話者が自分の深い体験談を語ることは稀です。
- 相槌（「うん」「へえー」「確かに」等）は、直前に長く話していた話者ではなく、聞いている側の話者であることが多いです。

## その他のルール
- タイムスタンプは [M:SS] 形式（例: [0:00], [1:30], [12:05]）
- 句読点（、。）は使わないでください。発言内容に句読点を含めないでください
- 疑問符（？）や感嘆符（！）は使ってOKです
- 1つの発言に複数のタイムスタンプを入れないでください
- 空行を挟まないでください。全行が連続するようにしてください`;

    const step2Result = await model.generateContent([
        { text: step2Prompt },
        audioContent
    ]);

    const transcription = step2Result.response.text();
    const step2Time = ((Date.now() - step2Start) / 1000).toFixed(1);
    console.log(`処理時間: ${step2Time}秒\n`);
    fs.writeFileSync(path.join(__dirname, '..', 'results', `${prefix}_step2_transcription.txt`), transcription, 'utf-8');
    console.log(`→ ${prefix}_step2_transcription.txt に保存\n`);

    // ==================== Step 3: 品質チェック ====================
    console.log('===== Step 3: 品質チェック =====\n');
    const step3Start = Date.now();

    const step3Prompt = `以下の文字起こし結果を、文脈情報と照らし合わせて品質チェックしてください。

## 文脈情報
${context}

## 話者名リスト（正しい表記）
${speakerList}

## 文字起こし結果
${transcription}

## チェック項目
1. **話者の取り違え**: 文脈上、別の人の発言ではないかと疑われる箇所を指摘してください
2. **文脈の矛盾**: ある話者が自分の体験を語っているのに、途中で別の話者に切り替わっている箇所
3. **フォーマットの問題**: 形式が崩れている行、話者名の文字化け（ローマ字やキリル文字の混入等）
4. **その他の問題**: 不自然な文、意味不明な箇所

## 出力形式
問題がない場合は「品質チェック: 問題なし」と出力してください。
問題がある場合は、以下の形式で出力してください：

【問題1】
行: （該当行をそのまま引用）
種別: 話者取り違え / 文字化け / フォーマット / その他
理由: （なぜ問題だと判断したか）
置換: [タイムスタンプ] 現在の話者名（性別） → 正しい話者名（性別）

置換の例：
置換: [4:34] おさき（女性） → ゆのん（女性）
置換: [25:45] おさき（女性） → みみこ（女性）

## 重要な制約
- 指摘できるのは「話者名の間違い」と「フォーマットの問題」のみです
- 発言内容のテキストには一切触れないでください。内容の正誤や表現の良し悪しは判定しないでください
- 音声から書き起こされた表現は、たとえ不自然でもそのまま維持すべきです
- 置換行のタイムスタンプは文字起こし結果の該当行と完全に一致させてください`;

    const step3Result = await model.generateContent([
        { text: step3Prompt }
    ]);

    const qualityCheck = step3Result.response.text();
    const step3Time = ((Date.now() - step3Start) / 1000).toFixed(1);
    console.log(`処理時間: ${step3Time}秒\n`);
    console.log(qualityCheck);
    fs.writeFileSync(path.join(__dirname, '..', 'results', `${prefix}_step3_quality.txt`), qualityCheck, 'utf-8');
    console.log(`→ ${prefix}_step3_quality.txt に保存\n`);

    // ==================== 結果出力 ====================
    const totalTime = (parseFloat(step1Time) + parseFloat(step2Time) + parseFloat(step3Time)).toFixed(1);
    console.log(`\n===== 処理時間まとめ =====`);
    console.log(`モデル: ${MODEL}`);
    console.log(`Step 1（文脈分析）: ${step1Time}秒`);
    console.log(`Step 2（文字起こし）: ${step2Time}秒`);
    console.log(`Step 3（品質チェック）: ${step3Time}秒`);
    console.log(`合計: ${totalTime}秒`);
}

transcribe().catch(err => {
    console.error('エラー:', err.message);
});
