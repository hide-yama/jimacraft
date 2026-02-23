/**
 * lib/auth-middleware.js
 * JWT検証ミドルウェア（Bearer token → ユーザー取得）
 */

const { supabase } = require('./supabase');

/**
 * リクエストのAuthorizationヘッダーからJWTを検証し、
 * req.user にユーザー情報、req.profile にプロフィールをセットする。
 * 認証失敗時は 401 を返す。
 */
async function authMiddleware(req, res, next) {
    if (!supabase) {
        return res.status(500).json({ error: '認証サービスが設定されていません' });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'ログインが必要です' });
    }

    const token = authHeader.slice(7);

    try {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) {
            return res.status(401).json({ error: '無効なトークンです' });
        }

        // プロフィール取得
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();

        if (profileError || !profile) {
            return res.status(401).json({ error: 'プロフィールが見つかりません' });
        }

        req.user = user;
        req.profile = profile;
        next();
    } catch (err) {
        console.error('認証エラー:', err);
        return res.status(401).json({ error: '認証に失敗しました' });
    }
}

module.exports = { authMiddleware };
