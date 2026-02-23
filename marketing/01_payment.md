# 課金システム

## 状態: 実装完了・デプロイ済み（2026-02-24）

## 決定事項
- **Stripe** を使用
- サブスクリプション型（月額/年額）
- フリーミアムモデル（Free / Plus / Pro の3段階）
- **ホスティング: Vercel**（デプロイ済み）
- 本番URL: https://jimacraft.vercel.app

## 実装済み
- [x] ユーザー認証（Supabase Google OAuth）
- [x] Stripe Checkout / Customer Portal の組み込み
- [x] 無料プランの制限（ステップ/話者数/月間回数）
- [x] Stripe の商品・価格設定（Plus ¥480/月、Pro ¥980/月）
- [x] Webhook連携（プラン自動同期）
- [x] Vercel環境変数設定・デプロイ

## 次のアクション
- [ ] 精緻なテスト（制限、決済フロー、キャンセル）
- [ ] Stripeを本番モードに切り替え
