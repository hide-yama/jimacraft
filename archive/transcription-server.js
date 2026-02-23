#!/usr/bin/env node
/**
 * 文字起こしAPIサーバー
 * - OpenAI Whisper API（高精度、話者識別なし）
 * - Google Cloud Speech-to-Text API（話者識別あり、10MB制限）
 * - AssemblyAI API（話者識別あり、5GB対応、推奨）
 */

const express = require('express');
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');
const speech = require('@google-cloud/speech');
const { AssemblyAI } = require('assemblyai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// CORS設定
app.use(cors({
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'file://', null],
    credentials: true
}));

app.use(express.json());
app.use(express.static('.'));

// ファイルアップロード設定
const upload = multer({
    dest: 'temp/',
    limits: {
        fileSize: 25 * 1024 * 1024, // 25MB (OpenAI制限)
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/m4a',
            'audio/mp4', 'video/mp4', 'audio/webm', 'audio/x-m4a'
        ];
        const allowedExtensions = ['.mp3', '.mp4', '.wav', '.m4a', '.webm'];
        const fileExtension = file.originalname.toLowerCase().match(/\.[^.]+$/)?.[0];

        if (allowedTypes.includes(file.mimetype) || (fileExtension && allowedExtensions.includes(fileExtension))) {
            cb(null, true);
        } else {
            cb(new Error(`サポートされていないファイル形式です: ${file.mimetype} (${file.originalname})`));
        }
    }
});

// API設定チェック
function checkAPIKeys() {
    if (!process.env.OPENAI_API_KEY) {
        console.warn('⚠️  OPENAI_API_KEY が設定されていません（OpenAI Whisper機能は使用不可）');
    }
    if (!process.env.ASSEMBLYAI_API_KEY) {
        console.warn('⚠️  ASSEMBLYAI_API_KEY が設定されていません（AssemblyAI機能は使用不可）');
    }
}

// OpenAI Whisper API による文字起こし
async function transcribeAudio(filePath, options = {}) {
    try {
        const FormData = require('form-data');
        const fetch = require('node-fetch');

        const formData = new FormData();
        formData.append('file', await fs.readFile(filePath), {
            filename: path.basename(filePath),
            contentType: 'audio/mpeg'
        });
        formData.append('model', options.model || 'whisper-1');

        // 日本語設定
        if (options.language) {
            formData.append('language', options.language);
        }

        // レスポンス形式
        if (options.response_format) {
            formData.append('response_format', options.response_format);
        }

        // プロンプト（精度向上用）
        if (options.prompt) {
            formData.append('prompt', options.prompt);
        }

        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                ...formData.getHeaders()
            },
            body: formData
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`OpenAI API エラー: ${response.status} - ${error}`);
        }

        return await response.json();

    } catch (error) {
        console.error('文字起こしエラー:', error);
        throw error;
    }
}

// Google Cloud Speech-to-Text による話者識別付き文字起こし
async function transcribeWithDiarization(filePath, options = {}) {
    try {
        // Google Cloud Speech クライアント初期化
        const client = new speech.SpeechClient();

        // ファイルサイズチェック
        const stats = await fs.stat(filePath);
        const fileSizeMB = stats.size / (1024 * 1024);
        console.log(`📏 ファイルサイズ: ${fileSizeMB.toFixed(2)}MB`);

        // 10MB以上の場合はLongRunningRecognizeを使用
        const useLongRunning = fileSizeMB > 9.5;

        if (useLongRunning) {
            console.log('📤 大きなファイルのため、Long Running Recognize APIを使用します');
        }

        // 音声ファイルを読み込み
        const audioBytes = await fs.readFile(filePath);
        const audio = useLongRunning
            ? { content: audioBytes.toString('base64') }
            : { content: audioBytes.toString('base64') };

        // 話者識別設定
        const diarizationConfig = {
            enableSpeakerDiarization: true,
            minSpeakerCount: options.minSpeakers || 2,
            maxSpeakerCount: options.maxSpeakers || 6
        };

        // リクエスト設定
        const config = {
            encoding: 'MP3',
            sampleRateHertz: options.sampleRate || 16000,
            languageCode: options.language || 'ja-JP',
            diarizationConfig: diarizationConfig,
            model: 'default',
            useEnhanced: true
        };

        const request = {
            audio: audio,
            config: config
        };

        console.log('🎤 Google Speech-to-Text で話者識別開始...');

        let response;

        if (useLongRunning) {
            // Long Running Recognize API（60分まで対応、非同期処理）
            const [operation] = await client.longRunningRecognize(request);
            console.log('⏳ 処理中... 完了までしばらくお待ちください');

            // 処理完了を待つ
            [response] = await operation.promise();
        } else {
            // 同期API（10MB/1分まで）
            [response] = await client.recognize(request);
        }

        if (!response.results || response.results.length === 0) {
            throw new Error('文字起こし結果が空です');
        }

        // 結果を整形
        const transcription = response.results
            .map(result => result.alternatives[0].transcript)
            .join('\n');

        // 話者情報付き結果を作成
        const wordsInfo = [];
        let lastSpeaker = null;
        let currentSegment = { speaker: null, startTime: 0, endTime: 0, words: [] };

        response.results.forEach(result => {
            const alternative = result.alternatives[0];
            if (alternative.words) {
                alternative.words.forEach(wordInfo => {
                    const speaker = wordInfo.speakerTag || 1;
                    const word = wordInfo.word;
                    const startTime = wordInfo.startTime?.seconds || 0;
                    const endTime = wordInfo.endTime?.seconds || 0;

                    // 話者が変わったら新しいセグメント
                    if (lastSpeaker !== speaker) {
                        if (currentSegment.words.length > 0) {
                            wordsInfo.push({
                                speaker: `Speaker ${currentSegment.speaker}`,
                                text: currentSegment.words.join(' '),
                                startTime: currentSegment.startTime,
                                endTime: currentSegment.endTime
                            });
                        }
                        currentSegment = {
                            speaker: speaker,
                            startTime: startTime,
                            endTime: endTime,
                            words: [word]
                        };
                        lastSpeaker = speaker;
                    } else {
                        currentSegment.words.push(word);
                        currentSegment.endTime = endTime;
                    }
                });
            }
        });

        // 最後のセグメントを追加
        if (currentSegment.words.length > 0) {
            wordsInfo.push({
                speaker: `Speaker ${currentSegment.speaker}`,
                text: currentSegment.words.join(' '),
                startTime: currentSegment.startTime,
                endTime: currentSegment.endTime
            });
        }

        return {
            text: transcription,
            segments: wordsInfo,
            language: options.language || 'ja-JP'
        };

    } catch (error) {
        console.error('❌ Google Speech-to-Text エラー:', error);
        throw error;
    }
}

// AssemblyAI による話者識別付き文字起こし（推奨）
async function transcribeWithAssemblyAI(filePath, options = {}) {
    try {
        if (!process.env.ASSEMBLYAI_API_KEY) {
            throw new Error('ASSEMBLYAI_API_KEY が設定されていません');
        }

        // AssemblyAI クライアント初期化
        const client = new AssemblyAI({
            apiKey: process.env.ASSEMBLYAI_API_KEY
        });

        console.log('🎤 AssemblyAI で話者識別付き文字起こし開始...');
        console.log(`   言語: ${options.language || 'ja (自動検出)'}`);
        console.log(`   話者識別: 有効`);

        // ファイルをアップロードして文字起こし
        const params = {
            audio: filePath,
            speaker_labels: true,  // 話者識別を有効化
            language_code: options.language || 'ja',  // 日本語
            language_detection: !options.language  // 言語が指定されていない場合は自動検出
        };

        const transcript = await client.transcripts.transcribe(params);

        if (transcript.status === 'error') {
            throw new Error(`AssemblyAI エラー: ${transcript.error}`);
        }

        console.log('✅ 文字起こし完了');

        // 話者別にセグメントを整理
        const segments = [];
        if (transcript.utterances) {
            transcript.utterances.forEach(utterance => {
                segments.push({
                    speaker: utterance.speaker,
                    text: utterance.text,
                    startTime: utterance.start / 1000,  // ミリ秒を秒に変換
                    endTime: utterance.end / 1000,
                    confidence: utterance.confidence
                });
            });
        }

        // 話者数をカウント
        const speakerCount = new Set(segments.map(s => s.speaker)).size;
        console.log(`👥 検出された話者数: ${speakerCount}人`);

        return {
            text: transcript.text,
            segments: segments,
            language: transcript.language_code || options.language || 'ja',
            confidence: transcript.confidence,
            audio_duration: transcript.audio_duration,
            speaker_count: speakerCount
        };

    } catch (error) {
        console.error('❌ AssemblyAI エラー:', error);
        throw error;
    }
}

// OpenAI Whisper API エンドポイント（話者識別なし）
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'オーディオファイルが必要です' });
        }

        console.log(`📄 ファイル受信: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(2)}MB)`);

        // オプション設定
        const options = {
            language: req.body.language || 'ja', // デフォルト日本語
            response_format: req.body.response_format || 'verbose_json',
            model: req.body.model || 'whisper-1',
            prompt: req.body.prompt || undefined
        };

        console.log('🔄 OpenAI Whisper で文字起こし開始...');
        const startTime = Date.now();

        const result = await transcribeAudio(req.file.path, options);

        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(1);

        console.log(`✅ 文字起こし完了 (${duration}秒)`);
        console.log(`📝 テキスト: ${result.text?.substring(0, 100)}...`);

        // 一時ファイル削除
        await fs.unlink(req.file.path).catch(console.error);

        res.json({
            success: true,
            provider: 'openai',
            text: result.text,
            language: result.language,
            duration: result.duration,
            segments: result.segments,
            processing_time: duration
        });

    } catch (error) {
        console.error('❌ API エラー:', error);

        // 一時ファイル削除
        if (req.file) {
            await fs.unlink(req.file.path).catch(console.error);
        }

        res.status(500).json({
            error: error.message,
            details: 'サーバーログを確認してください'
        });
    }
});

// Google Speech-to-Text API エンドポイント（話者識別あり）
app.post('/api/transcribe-diarization', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'オーディオファイルが必要です' });
        }

        // Google認証チェック
        if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            return res.status(500).json({
                error: 'Google Cloud認証が設定されていません',
                details: '.envファイルにGOOGLE_APPLICATION_CREDENTIALSを設定してください'
            });
        }

        console.log(`📄 ファイル受信: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(2)}MB)`);

        // オプション設定
        const options = {
            language: req.body.language || 'ja-JP',
            minSpeakers: parseInt(req.body.minSpeakers) || 2,
            maxSpeakers: parseInt(req.body.maxSpeakers) || 6,
            sampleRate: parseInt(req.body.sampleRate) || 16000
        };

        console.log(`🔄 Google Speech-to-Text で話者識別付き文字起こし開始...`);
        console.log(`   話者数: ${options.minSpeakers}〜${options.maxSpeakers}人`);
        const startTime = Date.now();

        const result = await transcribeWithDiarization(req.file.path, options);

        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(1);

        console.log(`✅ 話者識別付き文字起こし完了 (${duration}秒)`);
        console.log(`📝 テキスト: ${result.text?.substring(0, 100)}...`);
        console.log(`👥 話者数: ${new Set(result.segments.map(s => s.speaker)).size}人`);

        // 一時ファイル削除
        await fs.unlink(req.file.path).catch(console.error);

        res.json({
            success: true,
            provider: 'google',
            text: result.text,
            language: result.language,
            segments: result.segments,
            processing_time: duration,
            speaker_count: new Set(result.segments.map(s => s.speaker)).size
        });

    } catch (error) {
        console.error('❌ Google API エラー:', error);

        // 一時ファイル削除
        if (req.file) {
            await fs.unlink(req.file.path).catch(console.error);
        }

        res.status(500).json({
            error: error.message,
            details: 'サーバーログを確認してください。Google Cloud認証を確認してください。'
        });
    }
});

// AssemblyAI API エンドポイント（話者識別あり、推奨）
app.post('/api/transcribe-assemblyai', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'オーディオファイルが必要です' });
        }

        // AssemblyAI APIキーチェック
        if (!process.env.ASSEMBLYAI_API_KEY) {
            return res.status(500).json({
                error: 'AssemblyAI APIキーが設定されていません',
                details: '.envファイルにASSEMBLYAI_API_KEYを設定してください'
            });
        }

        console.log(`📄 ファイル受信: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(2)}MB)`);

        // オプション設定
        const options = {
            language: req.body.language || 'ja'
        };

        console.log(`🔄 AssemblyAI で話者識別付き文字起こし開始...`);
        const startTime = Date.now();

        const result = await transcribeWithAssemblyAI(req.file.path, options);

        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(1);

        console.log(`✅ 話者識別付き文字起こし完了 (${duration}秒)`);
        console.log(`📝 テキスト: ${result.text?.substring(0, 100)}...`);
        console.log(`👥 話者数: ${result.speaker_count}人`);
        console.log(`🎯 精度: ${(result.confidence * 100).toFixed(1)}%`);

        // 一時ファイル削除
        await fs.unlink(req.file.path).catch(console.error);

        res.json({
            success: true,
            provider: 'assemblyai',
            text: result.text,
            language: result.language,
            segments: result.segments,
            processing_time: duration,
            speaker_count: result.speaker_count,
            confidence: result.confidence,
            audio_duration: result.audio_duration
        });

    } catch (error) {
        console.error('❌ AssemblyAI API エラー:', error);

        // 一時ファイル削除
        if (req.file) {
            await fs.unlink(req.file.path).catch(console.error);
        }

        res.status(500).json({
            error: error.message,
            details: 'サーバーログを確認してください。AssemblyAI APIキーを確認してください。'
        });
    }
});

// ヘルスチェック
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        openai_key: process.env.OPENAI_API_KEY ? '設定済み' : '未設定'
    });
});

// HTMLファイル提供
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'mp4_to_mp3_with_transcription.html'));
});

// サーバー起動
checkAPIKeys();

app.listen(PORT, () => {
    console.log('🎯 文字起こしサーバー起動');
    console.log(`🌐 URL: http://localhost:${PORT}`);
    console.log('📁 静的ファイル: 現在のディレクトリ');
    console.log(`🔑 OpenAI API: ${process.env.OPENAI_API_KEY ? '設定済み' : '未設定'}`);
    console.log(`🔑 AssemblyAI API: ${process.env.ASSEMBLYAI_API_KEY ? '設定済み' : '未設定'}`);
    console.log(`🔑 Google Cloud API: ${process.env.GOOGLE_APPLICATION_CREDENTIALS ? '設定済み' : '未設定'}`);
});