/**
 * チャンク分割結果に対する Step 3（品質チェック: Pro）+ Step 4（プログラム置換）
 *
 * 入力: 結果_chunked_gemini-2.5-flash_combined.txt
 * Step 3: Gemini 2.5 Pro で品質チェック
 * Step 4: 置換命令をプログラムで機械的に適用
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

const API_KEY = 'AIzaSyBrEhondgX7CRsrEvpyraH_lODTBX_EQEg';
const MODEL = 'gemini-2.5-pro';

const transcriptionFile = path.join(__dirname, '..', 'results', '結果_chunked_gemini-2.5-flash_combined.txt');
const transcription = fs.readFileSync(transcriptionFile, 'utf-8');

const speakerList = `- ゆのん（女性）
- おさき（女性）
- みみこ（女性）
- ナレーター（女性）
- ディレクター（男性）`;

const description = '占い番組。みみこさんがおさきさんとゆのんさんを占っている。';

// ==================== Step 3: 品質チェック ====================

async function runStep3() {
    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({
        model: MODEL,
        generationConfig: { maxOutputTokens: 65536 }
    });

    console.log(`モデル: ${MODEL}`);
    console.log('Step 3: 品質チェック実行中...\n');
    const start = Date.now();

    const prompt = `以下の文字起こし結果を品質チェックしてください。

## この音声について
${description}

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

    const qualityFile = path.join(__dirname, '..', 'results', '結果_chunked_flash-pro_step3_quality.txt');
    fs.writeFileSync(qualityFile, qualityCheck, 'utf-8');
    console.log(`\n→ ${qualityFile} に保存`);

    return { qualityCheck };
}

// ==================== Step 4: プログラム置換 ====================

function extractReplacements(qualityText) {
    const replacements = [];
    const regex = /置換:\s*\[(\d+:\d+)\]\s*(.+?)（(男性|女性|不特定)）\s*→\s*(.+?)（(男性|女性|不特定)）/g;
    let match;
    while ((match = regex.exec(qualityText)) !== null) {
        replacements.push({
            timestamp: match[1],
            fromName: match[2].trim(),
            fromGender: match[3],
            toName: match[4].trim(),
            toGender: match[5]
        });
    }
    return replacements;
}

function applyReplacements(transcription, replacements) {
    const lines = transcription.split('\n');
    let applied = 0;
    let notFound = 0;

    for (const rep of replacements) {
        const target = `[${rep.timestamp}]`;
        const fromSpeaker = `${rep.fromName}（${rep.fromGender}）`;
        const toSpeaker = `${rep.toName}（${rep.toGender}）`;

        let found = false;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(target) && lines[i].startsWith(fromSpeaker)) {
                lines[i] = lines[i].replace(fromSpeaker, toSpeaker);
                console.log(`  OK [${rep.timestamp}] ${fromSpeaker} → ${toSpeaker}`);
                applied++;
                found = true;
                break;
            }
        }
        if (!found) {
            console.log(`  NG [${rep.timestamp}] ${fromSpeaker} → ${toSpeaker} （該当行なし）`);
            notFound++;
        }
    }

    return { result: lines.join('\n'), applied, notFound };
}

// ==================== メイン ====================

async function main() {
    console.log('===== チャンク分割(Flash) + 品質チェック(Pro) =====\n');

    // Step 3
    const { qualityCheck } = await runStep3();

    // Step 4
    console.log('\n===== Step 4: プログラム置換 =====\n');
    const replacements = extractReplacements(qualityCheck);
    console.log(`${replacements.length}件の置換命令を検出\n`);

    if (replacements.length === 0) {
        console.log('置換命令がありません。完了。');
        return;
    }

    console.log('置換を適用中...\n');
    const { result, applied, notFound } = applyReplacements(transcription, replacements);

    const outputFile = path.join(__dirname, '..', 'results', '結果_chunked_flash-pro_step4_corrected.txt');
    fs.writeFileSync(outputFile, result, 'utf-8');

    console.log(`\n===== 結果 =====`);
    console.log(`置換命令: ${replacements.length}件`);
    console.log(`適用成功: ${applied}件`);
    console.log(`該当なし: ${notFound}件`);
    console.log(`保存先: ${outputFile}`);
}

main().catch(err => console.error('エラー:', err.message));
