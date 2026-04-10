/**
 * チャンク分割文字起こし実験
 *
 * 実験内容:
 * - output.mp3（30分）を15分ごとに分割
 * - 各チャンクをGemini 2.5 Flashで文字起こし（Step 1なし、Step 2のみ）
 * - タイムスタンプにオフセットを加算して結合
 *
 * 比較対象: 結果_gemini-2.5-pro_step2_transcription.txt（30分一括、Pro、Step 1あり）
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const API_KEY = 'AIzaSyBrEhondgX7CRsrEvpyraH_lODTBX_EQEg';
const AUDIO_FILE = path.join(__dirname, '..', 'output.mp3');
const CHUNK_DURATION = 900; // 15分 = 900秒
const MODEL = 'gemini-2.5-flash';

// ユーザーが入力する話者情報（既存実験と同じ）
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

// ==================== MP3分割 ====================

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
        const chunkFile = path.join(__dirname, `_chunk_${i}.mp3`);

        execSync(
            `ffmpeg -y -ss ${startSec} -t ${chunkDuration} -i "${filePath}" -acodec copy "${chunkFile}" 2>/dev/null`
        );

        const chunkSize = fs.statSync(chunkFile).size;
        console.log(`チャンク${i + 1}: ${formatTime(startSec)} 〜 ${formatTime(Math.min(startSec + chunkDuration, duration))}（${(chunkSize / 1024 / 1024).toFixed(1)}MB）`);

        chunks.push({
            index: i,
            file: chunkFile,
            offsetSeconds: startSec
        });
    }

    return chunks;
}

function cleanupChunks(chunks) {
    for (const chunk of chunks) {
        if (fs.existsSync(chunk.file)) {
            fs.unlinkSync(chunk.file);
        }
    }
}

// ==================== タイムスタンプ処理 ====================

function formatTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = Math.floor(totalSeconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}

function addOffsetToTranscription(text, offsetSeconds) {
    if (offsetSeconds === 0) return text;

    const offsetMinutes = Math.floor(offsetSeconds / 60);
    const offsetSecs = offsetSeconds % 60;

    return text.split('\n').map(line => {
        return line.replace(/\[(\d+):(\d{2})\]/, (match, m, s) => {
            const totalSeconds = parseInt(m) * 60 + parseInt(s) + offsetSeconds;
            const newM = Math.floor(totalSeconds / 60);
            const newS = totalSeconds % 60;
            return `[${newM}:${String(newS).padStart(2, '0')}]`;
        });
    }).join('\n');
}

// ==================== Gemini文字起こし ====================

async function transcribeChunk(genAI, chunk, speakerList, speakerNames) {
    const model = genAI.getGenerativeModel({
        model: MODEL,
        generationConfig: { maxOutputTokens: 65536 }
    });

    const audioData = fs.readFileSync(chunk.file);
    const base64Audio = audioData.toString('base64');

    const audioContent = {
        inlineData: {
            mimeType: 'audio/mpeg',
            data: base64Audio
        }
    };

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

    const result = await model.generateContent([
        { text: prompt },
        audioContent
    ]);

    return result.response.text();
}

// ==================== メイン ====================

async function main() {
    console.log('===== チャンク分割文字起こし実験 =====');
    console.log(`モデル: ${MODEL}`);
    console.log(`チャンクサイズ: ${CHUNK_DURATION / 60}分\n`);

    // 音声を分割
    console.log('--- 音声分割 ---');
    const chunks = splitAudio(AUDIO_FILE, CHUNK_DURATION);
    console.log('');

    const genAI = new GoogleGenerativeAI(API_KEY);
    const speakerList = USER_INPUT.speakers.map(s => `- ${s.name}（${s.gender}）`).join('\n');
    const speakerNames = USER_INPUT.speakers.map(s => s.name).join('、');

    const results = [];
    let totalTime = 0;

    // 各チャンクを文字起こし
    for (const chunk of chunks) {
        const chunkLabel = `チャンク${chunk.index + 1}（${formatTime(chunk.offsetSeconds)}〜）`;
        console.log(`--- ${chunkLabel}: 文字起こし中... ---`);
        const start = Date.now();

        try {
            const transcription = await transcribeChunk(genAI, chunk, speakerList, speakerNames);
            const elapsed = ((Date.now() - start) / 1000).toFixed(1);
            totalTime += parseFloat(elapsed);

            // タイムスタンプにオフセット加算
            const adjusted = addOffsetToTranscription(transcription, chunk.offsetSeconds);

            const lineCount = adjusted.split('\n').filter(l => l.trim()).length;
            console.log(`完了: ${elapsed}秒、${lineCount}行\n`);

            // 個別チャンクの結果も保存
            fs.writeFileSync(
                path.join(__dirname, '..', 'results', `結果_chunked_${MODEL}_chunk${chunk.index + 1}.txt`),
                adjusted,
                'utf-8'
            );

            results.push(adjusted);
        } catch (err) {
            console.error(`エラー: ${err.message}\n`);
            results.push(`[チャンク${chunk.index + 1}でエラー: ${err.message}]`);
        }
    }

    // 結合
    const combined = results.join('\n');
    const outputFile = path.join(__dirname, '..', 'results', `結果_chunked_${MODEL}_combined.txt`);
    fs.writeFileSync(outputFile, combined, 'utf-8');

    // サマリー
    const totalLines = combined.split('\n').filter(l => l.trim()).length;
    console.log('===== 結果 =====');
    console.log(`モデル: ${MODEL}`);
    console.log(`チャンク数: ${chunks.length}`);
    console.log(`合計処理時間: ${totalTime.toFixed(1)}秒`);
    console.log(`合計行数: ${totalLines}`);
    console.log(`出力ファイル: ${outputFile}`);

    // 後片付け
    cleanupChunks(chunks);
    console.log('\nチャンクファイルを削除しました');
}

main().catch(err => {
    console.error('致命的エラー:', err.message);
});
