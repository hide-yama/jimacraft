/**
 * subtitle-editor-server.js
 * 字幕エディタWebアプリのExpressサーバー
 * - 認証（Supabase Google OAuth）
 * - プラン制限（Free/Plus/Pro）
 * - Stripe課金（Checkout / Portal / Webhook）
 * - 3つのAPIエンドポイント（Step1〜3）
 * - HTML配信（Supabase設定注入）
 */

require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { convertMdToSrt, processSrtEdits, splitBySpeaker } = require('./srt-processor');
const { supabase } = require('./lib/supabase');
const { stripe } = require('./lib/stripe');
const { authMiddleware } = require('./lib/auth-middleware');
const { planMiddleware, usageLimitMiddleware, checkSpeakerLimit, PLAN_LIMITS } = require('./lib/plan-middleware');

const app = express();
const PORT = process.env.SUBTITLE_PORT || 3002;

// ==================== Stripe Webhook（raw body必須、JSON parser前に登録） ====================

app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    if (!stripe || !supabase) {
        return res.status(500).json({ error: 'Stripe/Supabaseが設定されていません' });
    }

    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
        console.error('Webhook署名検証エラー:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object;
                const customerId = session.customer;
                const subscriptionId = session.subscription;

                // サブスクリプションから価格IDを取得
                const subscription = await stripe.subscriptions.retrieve(subscriptionId);
                const priceId = subscription.items.data[0].price.id;
                const plan = priceIdToPlan(priceId);

                // プロフィール更新
                await supabase
                    .from('profiles')
                    .update({ plan, stripe_customer_id: customerId, updated_at: new Date().toISOString() })
                    .eq('stripe_customer_id', customerId);

                console.log(`Checkout完了: customer=${customerId}, plan=${plan}`);
                break;
            }

            case 'customer.subscription.updated': {
                const subscription = event.data.object;
                const customerId = subscription.customer;
                const priceId = subscription.items.data[0].price.id;
                const plan = priceIdToPlan(priceId);

                if (subscription.cancel_at_period_end) {
                    // キャンセル予定（期間終了まで利用可能なのでプラン変更なし）
                    console.log(`サブスクリプションキャンセル予定: customer=${customerId}`);
                } else {
                    await supabase
                        .from('profiles')
                        .update({ plan, updated_at: new Date().toISOString() })
                        .eq('stripe_customer_id', customerId);
                    console.log(`サブスクリプション更新: customer=${customerId}, plan=${plan}`);
                }
                break;
            }

            case 'customer.subscription.deleted': {
                const subscription = event.data.object;
                const customerId = subscription.customer;

                await supabase
                    .from('profiles')
                    .update({ plan: 'free', updated_at: new Date().toISOString() })
                    .eq('stripe_customer_id', customerId);

                console.log(`サブスクリプション削除: customer=${customerId} → free`);
                break;
            }
        }

        res.json({ received: true });
    } catch (err) {
        console.error('Webhook処理エラー:', err);
        res.status(500).json({ error: 'Webhook処理中にエラーが発生しました' });
    }
});

// ==================== 通常ミドルウェア ====================

// JSON body parser（5MB上限）
app.use(express.json({ limit: '5mb' }));

// キャッシュ無効化
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
});

// ==================== 認証API ====================

// ユーザー情報取得
app.get('/api/me', authMiddleware, (req, res) => {
    const profile = req.profile;
    const limits = PLAN_LIMITS[profile.plan] || PLAN_LIMITS.free;
    res.json({
        id: profile.id,
        email: profile.email,
        displayName: profile.display_name,
        avatarUrl: profile.avatar_url,
        plan: profile.plan,
        usageCount: profile.usage_count,
        usageResetAt: profile.usage_reset_at,
        limits: {
            steps: limits.steps,
            maxSpeakers: limits.maxSpeakers === Infinity ? null : limits.maxSpeakers,
            monthlyLimit: limits.monthlyLimit === Infinity ? null : limits.monthlyLimit
        }
    });
});

// ==================== Stripe API ====================

// Checkout セッション作成
app.post('/api/stripe/checkout', authMiddleware, async (req, res) => {
    if (!stripe) {
        return res.status(500).json({ error: 'Stripeが設定されていません' });
    }

    const { priceId } = req.body;
    if (!priceId) {
        return res.status(400).json({ error: '価格IDが必要です' });
    }

    try {
        const profile = req.profile;
        let customerId = profile.stripe_customer_id;

        // Stripe Customer未作成なら作成
        if (!customerId) {
            const customer = await stripe.customers.create({
                email: profile.email,
                metadata: { supabase_user_id: profile.id }
            });
            customerId = customer.id;

            await supabase
                .from('profiles')
                .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
                .eq('id', profile.id);
        }

        const origin = req.headers.origin || `http://localhost:${PORT}`;
        const session = await stripe.checkout.sessions.create({
            customer: customerId,
            payment_method_types: ['card'],
            mode: 'subscription',
            line_items: [{ price: priceId, quantity: 1 }],
            success_url: `${origin}/?checkout=success`,
            cancel_url: `${origin}/?checkout=cancel`,
            allow_promotion_codes: true
        });

        res.json({ url: session.url });
    } catch (err) {
        console.error('Checkout作成エラー:', err);
        res.status(500).json({ error: 'Checkoutセッション作成に失敗しました' });
    }
});

// Customer Portal セッション作成
app.post('/api/stripe/portal', authMiddleware, async (req, res) => {
    if (!stripe) {
        return res.status(500).json({ error: 'Stripeが設定されていません' });
    }

    const profile = req.profile;
    if (!profile.stripe_customer_id) {
        return res.status(400).json({ error: 'サブスクリプションがありません' });
    }

    try {
        const origin = req.headers.origin || `http://localhost:${PORT}`;
        const session = await stripe.billingPortal.sessions.create({
            customer: profile.stripe_customer_id,
            return_url: origin
        });

        res.json({ url: session.url });
    } catch (err) {
        console.error('Portal作成エラー:', err);
        res.status(500).json({ error: 'Customer Portal作成に失敗しました' });
    }
});

// ==================== Step API エンドポイント ====================

// Step 1: MD形式テキスト → SRT変換
app.post('/api/step1/convert', authMiddleware, planMiddleware(1), usageLimitMiddleware, (req, res) => {
    try {
        const { text } = req.body;
        if (!text || !text.trim()) {
            return res.status(400).json({ error: '文字起こしテキストが空です' });
        }
        const result = convertMdToSrt(text);

        // 話者数チェック（freeプランは2人まで）
        const speakerCheck = checkSpeakerLimit(req.profile, result.speakers.length);
        if (!speakerCheck.allowed) {
            return res.status(403).json({
                error: speakerCheck.error,
                requiredPlan: speakerCheck.requiredPlan
            });
        }

        res.json(result);
    } catch (err) {
        console.error('Step1エラー:', err);
        res.status(500).json({ error: '変換処理中にエラーが発生しました: ' + err.message });
    }
});

// Step 2: マーカー付きSRT → 編集処理
app.post('/api/step2/edit', authMiddleware, planMiddleware(2), usageLimitMiddleware, (req, res) => {
    try {
        const { srt } = req.body;
        if (!srt || !srt.trim()) {
            return res.status(400).json({ error: 'SRTテキストが空です' });
        }
        const result = processSrtEdits(srt);
        res.json(result);
    } catch (err) {
        console.error('Step2エラー:', err);
        res.status(500).json({ error: '編集処理中にエラーが発生しました: ' + err.message });
    }
});

// Step 3: 編集済みSRT → 話者別分割
app.post('/api/step3/split', authMiddleware, planMiddleware(3), usageLimitMiddleware, (req, res) => {
    try {
        const { srt } = req.body;
        if (!srt || !srt.trim()) {
            return res.status(400).json({ error: 'SRTテキストが空です' });
        }
        const result = splitBySpeaker(srt);
        res.json(result);
    } catch (err) {
        console.error('Step3エラー:', err);
        res.status(500).json({ error: '分割処理中にエラーが発生しました: ' + err.message });
    }
});

// ==================== HTML配信 ====================

// ルートでHTML配信（Supabase設定を注入）
app.get('/', (req, res) => {
    const htmlPath = path.join(__dirname, 'subtitle-editor.html');
    fs.readFile(htmlPath, 'utf-8', (err, html) => {
        if (err) {
            console.error('HTML読み込みエラー:', err);
            return res.status(500).send('ページの読み込みに失敗しました');
        }

        // Supabase設定をHTMLに注入（</head>の前に挿入）
        const supabaseConfig = `
    <script>
        window.__SUPABASE_URL__ = '${process.env.SUPABASE_URL || ''}';
        window.__SUPABASE_ANON_KEY__ = '${process.env.SUPABASE_ANON_KEY || ''}';
        window.__STRIPE_PLUS_MONTHLY__ = '${process.env.STRIPE_PLUS_MONTHLY_PRICE_ID || ''}';
        window.__STRIPE_PLUS_YEARLY__ = '${process.env.STRIPE_PLUS_YEARLY_PRICE_ID || ''}';
        window.__STRIPE_PRO_MONTHLY__ = '${process.env.STRIPE_PRO_MONTHLY_PRICE_ID || ''}';
        window.__STRIPE_PRO_YEARLY__ = '${process.env.STRIPE_PRO_YEARLY_PRICE_ID || ''}';
    </script>`;

        html = html.replace('</head>', supabaseConfig + '\n</head>');
        res.type('html').send(html);
    });
});

// その他のルートは404
app.use((req, res) => {
    res.status(404).json({ error: 'Not Found' });
});

// ==================== ヘルパー ====================

function priceIdToPlan(priceId) {
    const plusMonthly = process.env.STRIPE_PLUS_MONTHLY_PRICE_ID;
    const plusYearly = process.env.STRIPE_PLUS_YEARLY_PRICE_ID;
    const proMonthly = process.env.STRIPE_PRO_MONTHLY_PRICE_ID;
    const proYearly = process.env.STRIPE_PRO_YEARLY_PRICE_ID;

    if (priceId === plusMonthly || priceId === plusYearly) return 'plus';
    if (priceId === proMonthly || priceId === proYearly) return 'pro';
    return 'free';
}

// ==================== サーバー起動 / エクスポート ====================

// Vercel: module.exports で Express app をエクスポート
// ローカル: 直接実行時のみ listen
if (process.env.VERCEL) {
    module.exports = app;
} else {
    app.listen(PORT, () => {
        console.log(`字幕エディタサーバー起動: http://localhost:${PORT}`);
    });
}
