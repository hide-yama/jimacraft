/**
 * Pro全ステップ実験: 15分チャンク分割 × Gemini 2.5 Pro
 *
 * Step 2: 各チャンクをProで文字起こし（文脈分析なし）
 * Step 3: 結合結果をProで品質チェック
 * Step 4: 置換命令をプログラムで適用
 *
 * 比較対象: 結果_gemini-2.5-pro_step4_corrected.txt（30分一括、Pro、Step 1あり）
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const API_KEY = 'AIzaSyBrEhondgX7CRsrEvpyraH_lODTBX_EQEg';
const AUDIO_FILE = path.join(__dirname, '..', 'output.mp3');
const CHUNK_DURATION = 900; // 15分
const MODEL = 'gemini-2.5-pro';

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

const speakerList = USER_INPUT.speakers.map(s => `- ${s.name}（${s.gender}）`).join('\n');

// ==================== 音声分割 ====================

function getAudioDuration(filePath) {
    const result = execSync(
        `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${filePath}"`,
        { encoding: 'utf-8' }
    );
    return parseFloat(result.trim());
}

function splitAudio(filePath, chunkDuration) {
    const duration = getAudioDuration(filePath);
    const numChunks = Math.ceil(duration / chunkDuration);
    const chunks = [];

    console.log(`音声の長さ: ${(duration / 60).toFixed(1)}分`);
    console.log(`チャンク数: ${numChunks}（各${chunkDuration / 60}分）\n`);

    for (let i = 0; i < numChunks; i++) {
        const startSec = i * chunkDuration;
        const chunkFile = path.join(__dirname, `_chunk_pro_${i}.mp3`);
        execSync(
            `ffmpeg -y -ss ${startSec} -t ${chunkDuration} -i "${filePath}" -acodec copy "${chunkFile}" 2>/dev/null`
        );
        const chunkSize = fs.statSync(chunkFile).size;
        console.log(`チャンク${i + 1}: ${formatTime(startSec)} 〜 ${formatTime(Math.min(startSec + chunkDuration, duration))}（${(chunkSize / 1024 / 1024).toFixed(1)}MB）`);
        chunks.push({ index: i, file: chunkFile, offsetSeconds: startSec });
    }
    return chunks;
}

function cleanupChunks(chunks) {
    for (const chunk of chunks) {
        if (fs.existsSync(chunk.file)) fs.unlinkSync(chunk.file);
    }
}

// ==================== ユーティリティ ====================

function formatTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = Math.floor(totalSeconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}

function addOffsetToTranscription(text, offsetSeconds) {
    if (offsetSeconds === 0) return text;
    return text.split('\n').map(line => {
        return line.replace(/\[(\d+):(\d{2})\]/, (match, m, s) => {
            const totalSeconds = parseInt(m) * 60 + parseInt(s) + offsetSeconds;
            const newM = Math.floor(totalSeconds / 60);
            const newS = totalSeconds % 60;
            return `[${newM}:${String(newS).padStart(2, '0')}]`;
        });
    }).join('\n');
}

// ==================== Step 2: 文字起こし ====================

async function transcribeChunk(genAI, chunk) {
    const model = genAI.getGenerativeModel({
        model: MODEL,
        generationConfig: { maxOutputTokens: 65536 }
    });

    const audioData = fs.readFileSync(chunk.file);
    const base64Audio = audioData.toString('base64');
    const audioContent = { inlineData: { mimeType: 'audio/mpeg', data: base64Audio } };

    const prompt = `以下の音声ファイルを文字起こししてください。

## この音声について
${USER_INPUT.description}

## 出力形式（厳守）
1発言1行で、以下の形式で出力してください：
話者名（性別）: [M:SS] 発言内容

出力例：
太郎（男性）: [0:15] こんにちは
花子（女性）: [0:20] よろしくお願いします

## 話者名のルール
- 以下の名前を正確にコピーして使用してください（1文字でも変えない）：
${speakerList}
- 上記以外の話者が登場した場合は「話者A（不特定）」「話者B（不特定）」等にしてください
- 括弧内は性別のみ（男性/女性/不特定）。日本語のみ使用。
- 必ず毎行の先頭に「話者名（性別）:」を付けてください。省略しないでください。
- 話者名にローマ字、キリル文字、その他の非日本語文字を混入させないでください。

## 話者判定のルール
- ある話者が自分自身の体験・思い出・意見を語り始めたら、その話題が終わるまで同じ話者が続く可能性が非常に高いです。途中で別の話者に切り替えないよう注意してください。
- 相槌（「うん」「へえー」「確かに」等）は、直前に長く話していた話者ではなく、聞いている側の話者であることが多いです。

## その他のルール
- タイムスタンプは [M:SS] 形式（例: [0:00], [1:30], [12:05]）
- 句読点（、。）は使わないでください。発言内容に句読点を含めないでください
- 疑問符（？）や感嘆符（！）は使ってOKです
- 1つの発言に複数のタイムスタンプを入れないでください
- 空行を挟まないでください。全行が連続するようにしてください`;

    const result = await model.generateContent([{ text: prompt }, audioContent]);
    return result.response.text();
}

// ==================== Step 3: 品質チェック ====================

async function runStep3(genAI, transcription) {
    const model = genAI.getGenerativeModel({
        model: MODEL,
        generationConfig: { maxOutputTokens: 65536 }
    });

    const prompt = `以下の文字起こし結果を品質チェックしてください。

## この音声について
${USER_INPUT.description}

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
    return result.response.text();
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
    console.log('===== Pro全ステップ: 15分チャンク分割実験 =====');
    console.log(`モデル: ${MODEL}\n`);

    // 音声分割
    console.log('--- 音声分割 ---');
    const chunks = splitAudio(AUDIO_FILE, CHUNK_DURATION);
    console.log('');

    const genAI = new GoogleGenerativeAI(API_KEY);
    const results = [];
    let totalStep2Time = 0;

    // Step 2: 各チャンクを文字起こし
    for (const chunk of chunks) {
        const chunkLabel = `チャンク${chunk.index + 1}（${formatTime(chunk.offsetSeconds)}〜）`;
        console.log(`--- Step 2: ${chunkLabel} 文字起こし中... ---`);
        const start = Date.now();

        try {
            const transcription = await transcribeChunk(genAI, chunk);
            const elapsed = ((Date.now() - start) / 1000).toFixed(1);
            totalStep2Time += parseFloat(elapsed);

            const adjusted = addOffsetToTranscription(transcription, chunk.offsetSeconds);
            const lineCount = adjusted.split('\n').filter(l => l.trim()).length;
            console.log(`完了: ${elapsed}秒、${lineCount}行\n`);

            fs.writeFileSync(
                path.join(__dirname, '..', 'results', `結果_chunked-pro_chunk${chunk.index + 1}.txt`),
                adjusted, 'utf-8'
            );
            results.push(adjusted);
        } catch (err) {
            console.error(`エラー: ${err.message}\n`);
            results.push(`[チャンク${chunk.index + 1}でエラー: ${err.message}]`);
        }
    }

    // 結合
    const combined = results.join('\n');
    const combinedFile = path.join(__dirname, '..', 'results', '結果_chunked-pro_combined.txt');
    fs.writeFileSync(combinedFile, combined, 'utf-8');
    console.log(`Step 2 合計: ${totalStep2Time.toFixed(1)}秒\n`);

    // Step 3: 品質チェック
    console.log('--- Step 3: 品質チェック ---');
    const step3Start = Date.now();
    const qualityCheck = await runStep3(genAI, combined);
    const step3Time = ((Date.now() - step3Start) / 1000).toFixed(1);
    console.log(`処理時間: ${step3Time}秒\n`);
    console.log(qualityCheck);

    const qualityFile = path.join(__dirname, '..', 'results', '結果_chunked-pro_step3_quality.txt');
    fs.writeFileSync(qualityFile, qualityCheck, 'utf-8');
    console.log(`\n→ ${qualityFile} に保存\n`);

    // Step 4: プログラム置換
    console.log('--- Step 4: プログラム置換 ---\n');
    const replacements = extractReplacements(qualityCheck);
    console.log(`${replacements.length}件の置換命令を検出\n`);

    let step4Applied = 0;
    let step4NotFound = 0;

    if (replacements.length > 0) {
        const { result, applied, notFound } = applyReplacements(combined, replacements);
        step4Applied = applied;
        step4NotFound = notFound;

        const outputFile = path.join(__dirname, '..', 'results', '結果_chunked-pro_step4_corrected.txt');
        fs.writeFileSync(outputFile, result, 'utf-8');
        console.log(`\n保存先: ${outputFile}`);
    }

    // サマリー
    const totalLines = combined.split('\n').filter(l => l.trim()).length;
    console.log(`\n===== 最終結果 =====`);
    console.log(`モデル: ${MODEL}`);
    console.log(`チャンク数: ${chunks.length}`);
    console.log(`Step 2 合計: ${totalStep2Time.toFixed(1)}秒`);
    console.log(`Step 3: ${step3Time}秒`);
    console.log(`合計行数: ${totalLines}`);
    console.log(`置換命令: ${replacements.length}件（成功${step4Applied} / 失敗${step4NotFound}）`);

    cleanupChunks(chunks);
    console.log('\nチャンクファイルを削除しました');
}

main().catch(err => console.error('致命的エラー:', err.message));
