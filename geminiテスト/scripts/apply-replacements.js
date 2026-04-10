/**
 * Step 4: 品質チェックの置換命令を機械的に適用する
 *
 * 使い方:
 * node geminiテスト/apply-replacements.js <transcription_file> <quality_file>
 *
 * 例:
 * node geminiテスト/apply-replacements.js \
 *   geminiテスト/結果_gemini-2.5-pro_step2_transcription.txt \
 *   geminiテスト/結果_gemini-2.5-pro_step3_quality.txt
 */

const fs = require('fs');
const path = require('path');

const transcriptionFile = process.argv[2];
const qualityFile = process.argv[3];

if (!transcriptionFile || !qualityFile) {
    console.error('使い方: node apply-replacements.js <transcription_file> <quality_file>');
    process.exit(1);
}

// 品質チェック結果から置換命令を抽出
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

// 文字起こし結果に置換を適用
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
                console.log(`  ✓ [${rep.timestamp}] ${fromSpeaker} → ${toSpeaker}`);
                applied++;
                found = true;
                break;
            }
        }
        if (!found) {
            console.log(`  ✗ [${rep.timestamp}] ${fromSpeaker} → ${toSpeaker} （該当行が見つかりません）`);
            notFound++;
        }
    }

    return { result: lines.join('\n'), applied, notFound };
}

// 実行
const transcription = fs.readFileSync(transcriptionFile, 'utf-8');
const qualityText = fs.readFileSync(qualityFile, 'utf-8');

console.log('置換命令を抽出中...\n');
const replacements = extractReplacements(qualityText);
console.log(`${replacements.length}件の置換命令を検出\n`);

if (replacements.length === 0) {
    console.log('置換命令がありません。');
    process.exit(0);
}

console.log('置換を適用中...\n');
const { result, applied, notFound } = applyReplacements(transcription, replacements);

// 結果を保存
const outputFile = transcriptionFile.replace('_step2_transcription', '_step4_corrected');
fs.writeFileSync(outputFile, result, 'utf-8');

console.log(`\n===== 結果 =====`);
console.log(`置換命令: ${replacements.length}件`);
console.log(`適用成功: ${applied}件`);
console.log(`該当なし: ${notFound}件`);
console.log(`保存先: ${outputFile}`);
