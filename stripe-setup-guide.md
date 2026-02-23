# Stripe セットアップ手順

## 1. テストモード確認
- https://dashboard.stripe.com/ を開く
- 「サンドボックス」モードになっていることを確認

## 2. 商品と価格を作成

「商品カタログ」→「+ 商品を作成」で以下を作成:

### 商品1: jimacraft Plus

まず月払いで商品を作成:
- 名前: jimacraft Plus
- 説明: Step 1 + Step 2、話者数無制限、月10回まで
- 画像: 空でOK
- 料金: 継続
- 金額: 480（JPY）
- 請求期間: 月次
→「商品を追加」

作成後、商品詳細ページで年払い価格を追加:
- 「+ 料金を追加」をクリック
- 料金: 継続
- 金額: 4800（JPY）
- 請求期間: 年次
→ 保存

### 商品2: jimacraft Pro

まず月払いで商品を作成:
- 名前: jimacraft Pro
- 説明: 全Step利用可、話者数無制限、回数無制限
- 画像: 空でOK
- 料金: 継続
- 金額: 980（JPY）
- 請求期間: 月次
→「商品を追加」

作成後、商品詳細ページで年払い価格を追加:
- 「+ 料金を追加」をクリック
- 料金: 継続
- 金額: 9800（JPY）
- 請求期間: 年次
→ 保存

## 3. 価格IDをメモ
各価格の横に `price_xxxx` というIDが表示される。
4つの価格IDを .env に設定:

- STRIPE_PLUS_MONTHLY_PRICE_ID=price_xxx（Plus 月払い ¥480）
- STRIPE_PLUS_YEARLY_PRICE_ID=price_xxx（Plus 年払い ¥4,800）
- STRIPE_PRO_MONTHLY_PRICE_ID=price_xxx（Pro 月払い ¥980）
- STRIPE_PRO_YEARLY_PRICE_ID=price_xxx（Pro 年払い ¥9,800）

## 4. APIキーを取得
左下「開発者」→「APIキー」で:
- シークレットキー（sk_test_xxx）→ STRIPE_SECRET_KEY に設定

## 5. Customer Portal を有効化
「設定」→「Billing」→「カスタマーポータル」→ 有効化
