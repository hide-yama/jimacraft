/**
 * lib/plan-middleware.js
 * プラン制限チェックミドルウェア
 */

const { supabase } = require('./supabase');

const PLAN_LIMITS = {
    free:  { steps: [1],       maxSpeakers: 2,   monthlyLimit: 3  },
    plus:  { steps: [1, 2],    maxSpeakers: Infinity, monthlyLimit: 10 },
    pro:   { steps: [1, 2, 3], maxSpeakers: Infinity, monthlyLimit: Infinity }
};

/**
 * ステップアクセス制限ミドルウェア
 * @param {number} stepNumber - アクセスするステップ番号 (1, 2, 3)
 */
function planMiddleware(stepNumber) {
    return (req, res, next) => {
        const profile = req.profile;
        const limits = PLAN_LIMITS[profile.plan] || PLAN_LIMITS.free;

        if (!limits.steps.includes(stepNumber)) {
            const requiredPlan = stepNumber === 3 ? 'Pro' : 'Plus';
            return res.status(403).json({
                error: `この機能は${requiredPlan}プラン以上で利用できます`,
                requiredPlan: requiredPlan.toLowerCase(),
                currentPlan: profile.plan
            });
        }

        next();
    };
}

/**
 * 月間利用回数チェック＆インクリメント
 * usage_reset_at を過ぎていたらリセットしてからチェック。
 * authMiddleware の後に使用すること。
 */
async function usageLimitMiddleware(req, res, next) {
    if (!supabase) {
        return res.status(500).json({ error: '認証サービスが設定されていません' });
    }

    const profile = req.profile;
    const limits = PLAN_LIMITS[profile.plan] || PLAN_LIMITS.free;

    // 無制限プランはスキップ
    if (limits.monthlyLimit === Infinity) {
        return next();
    }

    const now = new Date();
    const resetAt = new Date(profile.usage_reset_at);

    // リセット期限を過ぎていたらカウントリセット
    if (now >= resetAt) {
        const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const { error } = await supabase
            .from('profiles')
            .update({
                usage_count: 0,
                usage_reset_at: nextReset.toISOString(),
                updated_at: now.toISOString()
            })
            .eq('id', profile.id);

        if (error) {
            console.error('利用回数リセットエラー:', error);
            return res.status(500).json({ error: '利用状況の更新に失敗しました' });
        }

        profile.usage_count = 0;
        profile.usage_reset_at = nextReset.toISOString();
    }

    // 利用回数チェック
    if (profile.usage_count >= limits.monthlyLimit) {
        return res.status(429).json({
            error: `今月の利用回数上限（${limits.monthlyLimit}回）に達しました`,
            limit: limits.monthlyLimit,
            used: profile.usage_count,
            resetsAt: profile.usage_reset_at
        });
    }

    // カウントインクリメント
    const { error } = await supabase
        .from('profiles')
        .update({
            usage_count: profile.usage_count + 1,
            updated_at: now.toISOString()
        })
        .eq('id', profile.id);

    if (error) {
        console.error('利用回数更新エラー:', error);
        return res.status(500).json({ error: '利用状況の更新に失敗しました' });
    }

    req.profile.usage_count += 1;
    next();
}

/**
 * 話者数チェック（Step 1のレスポンスをフック）
 * freeプランは話者2人まで。
 */
function checkSpeakerLimit(profile, speakerCount) {
    const limits = PLAN_LIMITS[profile.plan] || PLAN_LIMITS.free;
    if (speakerCount > limits.maxSpeakers) {
        return {
            allowed: false,
            error: `Freeプランでは話者${limits.maxSpeakers}人までです（検出: ${speakerCount}人）`,
            requiredPlan: 'plus'
        };
    }
    return { allowed: true };
}

module.exports = { PLAN_LIMITS, planMiddleware, usageLimitMiddleware, checkSpeakerLimit };
