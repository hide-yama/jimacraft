/**
 * lib/supabase.js
 * サーバー側Supabaseクライアント（Service Role Key使用）
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.warn('Supabase環境変数が未設定です（SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY）');
}

const supabase = supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;

module.exports = { supabase };
