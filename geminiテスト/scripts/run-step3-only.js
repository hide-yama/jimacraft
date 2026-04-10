/**
 * Step 3のみ再実行（Step 1, 2の結果ファイルを読み込んで使用）
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

const API_KEY = 'AIzaSyBrEhondgX7CRsrEvpyraH_lODTBX_EQEg';
const MODEL = 'gemini-2.5-pro';

const prefix = `結果_${MODEL}`;
const context = fs.readFileSync(path.join(__dirname, '..', 'results', `${prefix}_step1_context.txt`), 'utf-8');
const transcription = fs.readFileSync(path.join(__dirname, '..', 'results', `${prefix}_step2_transcription.txt`), 'utf-8');

const speakerList = `- ゆのん（女性）
- おさき（女性）
- みみこ（女性）
- ナレーター（女性）
- ディレクター（男性）`;

async function runStep3() {
    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({
        model: MODEL,
        generationConfig: { maxOutputTokens: 65536 }
    });

    console.log(`モデル: ${MODEL}`);
    console.log('Step 3: 品質チェック実行中...\n');
    const start = Date.now();

    const prompt = `以下の文字起こし結果を、文脈情報と照らし合わせて品質チェックしてください。

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

    const result = await model.generateContent([{ text: prompt }]);
    const qualityCheck = result.response.text();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    console.log(`処理時間: ${elapsed}秒\n`);
    console.log(qualityCheck);

    fs.writeFileSync(path.join(__dirname, '..', 'results', `${prefix}_step3_quality.txt`), qualityCheck, 'utf-8');
    console.log(`\n→ ${prefix}_step3_quality.txt に保存`);
}

runStep3().catch(err => console.error('エラー:', err.message));
