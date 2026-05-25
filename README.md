# 社内AIチャット

Claude AIを活用した社内向けチャットシステムです。PDF・Word・テキストファイルをアップロードして、内容について質問できるRAG（検索拡張生成）機能を搭載しています。

## 機能

- 💬 **リアルタイムストリーミングチャット** — Claudeの回答が文字単位でリアルタイムに表示
- 📄 **文書アップロード・RAG** — PDF / Word (.docx) / テキストファイルをアップロードして内容を参照
- 📚 **複数文書管理** — 複数の文書をアップロードし、参照する文書をチェックボックスで切り替え
- 🔍 **シンプルなベクトル検索** — TF-IDFコサイン類似度による軽量なRAG（外部APIなし）

## 技術スタック

| 項目 | 技術 |
|------|------|
| フレームワーク | Next.js 14 (App Router) |
| AI SDK | Vercel AI SDK + `@ai-sdk/anthropic` |
| LLM | Claude claude-sonnet-4-6 |
| スタイル | Tailwind CSS |
| PDF解析 | pdf-parse |
| Word解析 | mammoth |
| ベクトル検索 | TF-IDF（インプロセス） |
| サーバー側永続化 | Vercel KV（Upstash Redis）※任意 |
| クライアント側永続化 | localStorage + TF-IDF RAG |

## ローカル開発

### 1. リポジトリのクローン

```bash
git clone https://github.com/your-org/company-ai-chat.git
cd company-ai-chat
```

### 2. 依存関係のインストール

```bash
npm install
```

### 3. 環境変数の設定

```bash
cp .env.example .env.local
```

`.env.local` を編集して Anthropic API キーを設定します：

```env
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxx
```

API キーは [Anthropic Console](https://console.anthropic.com/) で取得できます。

### 4. 開発サーバーの起動

```bash
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開きます。

---

## Vercel KV（推奨）のセットアップ

Vercel KV を使うとサーバーレス環境でも文書データが複数インスタンス間で共有されます。
設定しない場合はインメモリ動作になりますが、クライアントの localStorage に
チャンクが保存されているためチャット機能は正常に動作します。

### Vercel Dashboard から KV を有効化する手順

1. [Vercel Dashboard](https://vercel.com/dashboard) → プロジェクトを選択
2. **Storage** タブ → **Create Database** → **KV** を選択
3. データベース名を入力（例: `company-ai-chat-kv`）→ **Create**
4. **Connect to Project** でこのプロジェクトに紐付け
5. **Settings** → **Environment Variables** に以下が自動追加されていることを確認：
   - `KV_URL`
   - `KV_REST_API_URL`
   - `KV_REST_API_TOKEN`
   - `KV_REST_API_READ_ONLY_TOKEN`
6. **Redeploy** して反映

### ローカル開発で KV を使う場合

```bash
# Vercel CLI で環境変数をローカルに取得
npm i -g vercel
vercel link        # プロジェクトに紐付け
vercel env pull .env.local  # KV_URL 等を .env.local に書き出し
npm run dev
```

### Upstash Console から直接作成する場合

1. [console.upstash.com](https://console.upstash.com/) で無料 Redis DB を作成
2. **REST API** タブから以下をコピーして `.env.local` に設定：
   ```env
   KV_REST_API_URL=https://xxxxx.upstash.io
   KV_REST_API_TOKEN=xxxxx
   ```

---

## Vercel へのデプロイ手順

### 方法1：Vercel CLI（推奨）

```bash
# Vercel CLIのインストール
npm i -g vercel

# デプロイ（初回）
vercel

# 本番デプロイ
vercel --prod
```

### 方法2：GitHub連携（自動デプロイ）

1. このリポジトリを GitHub にプッシュ
2. [Vercel Dashboard](https://vercel.com/new) を開く
3. **"Add New Project"** をクリック
4. GitHub リポジトリを選択して **"Import"**
5. **Environment Variables** に以下を設定：
   - Key: `ANTHROPIC_API_KEY`
   - Value: `sk-ant-xxxxxxxx...`（Anthropic ConsoleのAPIキー）
6. **"Deploy"** をクリック

### 環境変数の設定（Vercel Dashboard）

デプロイ後に環境変数を追加・変更する場合：

1. Vercel Dashboard → プロジェクトを選択
2. **Settings** → **Environment Variables**
3. `ANTHROPIC_API_KEY` を追加
4. **Redeploy** で反映

---

## ファイル構成

```
company-ai-chat/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── chat/route.ts          # チャットAPI（ストリーミング）
│   │   │   └── documents/
│   │   │       ├── route.ts           # 文書一覧・削除API
│   │   │       └── upload/route.ts    # 文書アップロードAPI
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── globals.css
│   ├── components/
│   │   ├── ChatInterface.tsx          # メインのチャット画面
│   │   ├── DocumentSidebar.tsx        # 左サイドバー（文書管理）
│   │   └── MessageBubble.tsx          # メッセージ表示
│   ├── lib/
│   │   ├── document-store.ts          # インメモリ文書ストア
│   │   ├── text-extractor.ts          # テキスト抽出（PDF/Word/テキスト）
│   │   └── rag.ts                     # TF-IDF ベクトル検索
│   └── types/index.ts                 # TypeScript型定義
├── .env.example
├── next.config.ts
├── tailwind.config.ts
└── package.json
```

## アーキテクチャと永続化の仕組み

### 文書データの2層保存

```
アップロード時
  ↓ サーバー → テキスト抽出 → チャンク分割
  ↓ ①Vercel KV に保存（設定時）
  ↓ ②レスポンスでチャンクをクライアントに返す
  ↓ ③ブラウザ localStorage に保存

チャット送信時
  ↓ ①ブラウザ側で TF-IDF 検索（最大6チャンク選択）
  ↓ ②context 文字列として API に送信
  ↓ ③サーバーはコンテキストをシステムプロンプトに注入
  ↓ ④KV / インメモリはフォールバックとして使用
```

| 環境 | サーバー側 | クライアント側 |
|------|-----------|--------------|
| Vercel KV 有効 | KV で永続化 ✅ | localStorage にも保存 |
| KV 未設定 | インメモリ（リクエスト単位）| localStorage がメイン ✅ |
| ローカル開発 | インメモリ（起動中のみ）| localStorage がメイン ✅ |

> **Vercel KV を設定しなくてもチャット機能は正常に動作します。**
> クライアントの localStorage が文書チャンクを保持するため、
> インスタンス間の状態共有問題は発生しません。

### 対応ファイル形式

| 形式 | 拡張子 |
|------|--------|
| PDF | `.pdf` |
| Word | `.docx`, `.doc` |
| テキスト | `.txt`, `.md`, `.csv` |

最大ファイルサイズ：**10MB**

## ライセンス

MIT