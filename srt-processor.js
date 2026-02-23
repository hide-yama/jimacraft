/**
 * srt-processor.js
 * Step1〜3のPython字幕処理ロジックをJavaScriptに移植したモジュール
 */

// ==================== 共通ユーティリティ ====================

function timeToMs(timeStr) {
    const [h, m, sMs] = timeStr.split(':');
    const [s, ms] = sMs.split(',');
    return parseInt(h) * 3600000 + parseInt(m) * 60000 + parseInt(s) * 1000 + parseInt(ms);
}

function msToTime(ms) {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const msRemainder = ms % 1000;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(msRemainder).padStart(3, '0')}`;
}

function parseSrtWithoutNumbers(content) {
    const lines = content.trim().split('\n').map(l => l.trim()).filter(l => l);
    const subtitles = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        if (line.includes(' --> ')) {
            const match = line.match(/(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/);
            if (match && i + 1 < lines.length) {
                subtitles.push({
                    start: match[1],
                    end: match[2],
                    text: lines[i + 1]
                });
                i += 2;
            } else {
                i += 1;
            }
        } else {
            i += 1;
        }
    }
    return subtitles;
}

// ==================== Step 1: MD → SRT変換 ====================

function parseTime(timeStr) {
    const match = timeStr.match(/\[(\d+):(\d+)\]/);
    if (match) {
        let minutes = parseInt(match[1]);
        let seconds = parseInt(match[2]);
        const hours = Math.floor(minutes / 60);
        minutes = minutes % 60;
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},000`;
    }
    return null;
}

function splitTextBySentence(text) {
    const sentences = text.split('。');
    const lines = [];
    for (let i = 0; i < sentences.length; i++) {
        let sentence = sentences[i];
        if (i < sentences.length - 1) {
            sentence += '。';
        }
        if (sentence.trim()) {
            lines.push(sentence.trim());
        }
    }
    return lines;
}

function splitSubtitleTimeByDuration(startTime, endTime, numParts) {
    const startMs = timeToMs(startTime);
    const endMs = timeToMs(endTime);
    const totalDuration = endMs - startMs;

    const minDuration = 1000;
    const partDuration = Math.max(Math.floor(totalDuration / numParts), minDuration);

    const timecodes = [];
    for (let i = 0; i < numParts; i++) {
        const partStart = startMs + (i * partDuration);
        let partEnd;
        if (i === numParts - 1) {
            partEnd = endMs;
        } else {
            partEnd = partStart + partDuration;
            if (partEnd > endMs) {
                partEnd = endMs;
            }
        }
        timecodes.push([msToTime(partStart), msToTime(partEnd)]);
    }
    return timecodes;
}

function convertMdToSrt(inputText) {
    const lines = inputText.split('\n');
    const subtitles = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        // パース: 話者名（性別）: [時間] 発言内容
        const match = line.match(/^([^（]+)（[^）]+）:\s*(\[\d+:\d+\])\s*(.+)$/);
        if (match) {
            const speaker = match[1];
            const timeStr = match[2];
            const text = match[3];

            const startTime = parseTime(timeStr);
            if (startTime) {
                // 次の行の時間を探して終了時間とする
                let endTime = null;
                for (let j = i + 1; j < lines.length; j++) {
                    const nextMatch = lines[j].trim().match(/^[^（]+（[^）]+）:\s*(\[\d+:\d+\])/);
                    if (nextMatch) {
                        endTime = parseTime(nextMatch[1]);
                        break;
                    }
                }

                // 最後の字幕の場合、3秒後に設定
                if (!endTime) {
                    const timeParts = startTime.split(':');
                    let seconds = parseInt(timeParts[2].split(',')[0]);
                    seconds += 3;
                    let minutes = parseInt(timeParts[1]);
                    let hours = parseInt(timeParts[0]);

                    if (seconds >= 60) {
                        minutes += Math.floor(seconds / 60);
                        seconds = seconds % 60;
                    }
                    if (minutes >= 60) {
                        hours += Math.floor(minutes / 60);
                        minutes = minutes % 60;
                    }
                    endTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},000`;
                }

                // 句点で分割
                const sentences = splitTextBySentence(text);

                if (sentences.length <= 1) {
                    subtitles.push({
                        start: startTime,
                        end: endTime,
                        text: `${speaker}: ${text}`
                    });
                } else {
                    const timecodes = splitSubtitleTimeByDuration(startTime, endTime, sentences.length);
                    for (let k = 0; k < sentences.length; k++) {
                        subtitles.push({
                            start: timecodes[k][0],
                            end: timecodes[k][1],
                            text: `${speaker}: ${sentences[k]}`
                        });
                    }
                }
            }
        }
    }

    // SRT文字列を生成（ナンバリングなし）
    let srtOutput = '';
    for (const sub of subtitles) {
        srtOutput += `${sub.start} --> ${sub.end}\n`;
        srtOutput += `${sub.text}\n`;
        srtOutput += '\n';
    }

    // 話者一覧を抽出
    const speakers = [...new Set(subtitles.map(s => {
        const m = s.text.match(/^([^:]+):/);
        return m ? m[1] : '';
    }).filter(s => s))];

    return {
        srt: srtOutput.trim(),
        subtitleCount: subtitles.length,
        speakers: speakers
    };
}

// ==================== Step 2: マーカー編集 ====================

function splitSubtitle(subtitle) {
    const text = subtitle.text;
    if (!text.includes('/')) {
        return [subtitle];
    }

    let speaker = '';
    let content = text;
    if (text.includes(':')) {
        const colonIdx = text.indexOf(':');
        speaker = text.substring(0, colonIdx) + ': ';
        content = text.substring(colonIdx + 1).trim();
    }

    const parts = content.split('/');
    if (parts.length < 2) {
        return [subtitle];
    }

    // 最初の/のみで分割
    const part1 = parts[0].trim();
    const part2 = parts.slice(1).join('/').trim();

    const totalChars = part1.length + part2.length;
    if (totalChars === 0) {
        return [subtitle];
    }

    const startMs = timeToMs(subtitle.start);
    const endMs = timeToMs(subtitle.end);
    const totalDuration = endMs - startMs;

    const part1Ratio = part1.length / totalChars;
    let part1Duration = Math.floor(totalDuration * part1Ratio);

    // 最小表示時間を1秒に設定
    part1Duration = Math.max(part1Duration, 1000);
    const part2Duration = totalDuration - part1Duration + 2000; // +2秒延長

    const part1End = startMs + part1Duration;
    const part2Start = part1End;
    const part2End = part2Start + part2Duration;

    return [
        {
            start: msToTime(startMs),
            end: msToTime(part1End),
            text: speaker + part1
        },
        {
            start: msToTime(part2Start),
            end: msToTime(part2End),
            text: speaker + part2
        }
    ];
}

function mergeSubtitles(subtitle1, subtitle2) {
    // -マーカーを除去
    const text1 = subtitle1.text.replace(/-$/, '').trim();
    let text2 = subtitle2.text;

    // 話者名を抽出（text2から話者名を除去）
    if (text2.includes(':')) {
        const colonIdx = text2.indexOf(':');
        text2 = text2.substring(colonIdx + 1).trim();
    }

    return {
        start: subtitle1.start,
        end: subtitle2.end,
        text: text1 + text2
    };
}

function processSrtEdits(srtContent) {
    const subtitles = parseSrtWithoutNumbers(srtContent);
    const originalCount = subtitles.length;

    const processed = [];
    const operations = { deleted: 0, merged: 0, split: 0 };

    let i = 0;
    while (i < subtitles.length) {
        const current = subtitles[i];

        // 削除処理 (x マーカー)（スペース有り無し両対応）
        if (current.text.startsWith('x ') || current.text.startsWith('x')) {
            // 'x'の後に話者名が続くパターンをチェック
            if (current.text.match(/^x\s*[^:]+:/)) {
                operations.deleted++;
                i++;
                continue;
            }
        }

        // 結合処理 (- マーカー)
        if (current.text.endsWith('-')) {
            const currentSpeaker = current.text.includes(':') ? current.text.split(':')[0] : '';

            // 同じ話者の次の字幕を探す
            let foundNext = null;
            let nextIndex = -1;
            for (let j = i + 1; j < subtitles.length; j++) {
                const candidate = subtitles[j];

                // 削除マーカー付きの字幕はスキップ
                if (candidate.text.match(/^x\s*[^:]+:/)) {
                    continue;
                }

                const candidateSpeaker = candidate.text.includes(':') ? candidate.text.split(':')[0] : '';
                if (candidateSpeaker === currentSpeaker) {
                    foundNext = candidate;
                    nextIndex = j;
                    break;
                }
            }

            if (foundNext) {
                // 間に挟まっている字幕をそのまま保持
                for (let k = i + 1; k < nextIndex; k++) {
                    const between = subtitles[k];
                    // 間の字幕も削除マーカーチェック
                    if (between.text.match(/^x\s*[^:]+:/)) {
                        operations.deleted++;
                        continue;
                    }
                    processed.push(between);
                }

                // 結合処理
                const merged = mergeSubtitles(current, foundNext);
                operations.merged++;

                // 結合後の結果に/が含まれている場合は分割処理を実行
                if (merged.text.includes('/')) {
                    const splitParts = splitSubtitle(merged);
                    processed.push(...splitParts);
                    operations.split += splitParts.length - 1;
                } else {
                    processed.push(merged);
                }

                i = nextIndex + 1;
                continue;
            }
        }

        // 分割処理 (/ マーカー)
        if (current.text.includes('/')) {
            const splitParts = splitSubtitle(current);
            processed.push(...splitParts);
            if (splitParts.length > 1) {
                operations.split += splitParts.length - 1;
            }
            i++;
            continue;
        }

        // 通常処理
        processed.push(current);
        i++;
    }

    // SRT文字列を生成
    let srtOutput = '';
    for (const sub of processed) {
        srtOutput += `${sub.start} --> ${sub.end}\n`;
        srtOutput += `${sub.text}\n`;
        srtOutput += '\n';
    }

    return {
        srt: srtOutput.trim(),
        originalCount: originalCount,
        editedCount: processed.length,
        operations: operations
    };
}

// ==================== Step 3: 話者別分割 ====================

function splitBySpeaker(srtContent) {
    const subtitles = parseSrtWithoutNumbers(srtContent);
    const speakerSubtitles = {};

    for (const sub of subtitles) {
        const match = sub.text.match(/^([^:]+):\s*(.+)$/);
        if (match) {
            const speaker = match[1];
            const contentText = match[2];

            if (!speakerSubtitles[speaker]) {
                speakerSubtitles[speaker] = [];
            }

            speakerSubtitles[speaker].push({
                start: sub.start,
                end: sub.end,
                text: contentText
            });
        }
    }

    // 話者別にナンバリング有りSRTを生成
    const result = {};
    for (const [speaker, subs] of Object.entries(speakerSubtitles)) {
        let srtOutput = '';
        for (let i = 0; i < subs.length; i++) {
            srtOutput += `${i + 1}\n`;
            srtOutput += `${subs[i].start} --> ${subs[i].end}\n`;
            srtOutput += `${subs[i].text}\n`;
            srtOutput += '\n';
        }

        result[speaker] = {
            srt: srtOutput.trim(),
            count: subs.length
        };
    }

    return { speakers: result };
}

// ==================== エクスポート ====================

module.exports = {
    convertMdToSrt,
    processSrtEdits,
    splitBySpeaker,
    // テスト用にユーティリティも公開
    timeToMs,
    msToTime,
    parseSrtWithoutNumbers,
    splitSubtitle,
    mergeSubtitles
};
