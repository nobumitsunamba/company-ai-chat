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

## 注意事項

### インメモリストレージについて

現在の実装では文書データはサーバーのメモリに保存されます。

- **開発環境（`npm run dev`）**: サーバー再起動でリセットされます
- **Vercel（サーバーレス）**: 関数インスタンスが再起動するとリセットされます

**本番運用向けの推奨事項：**

永続化が必要な場合は [Vercel KV](https://vercel.com/docs/storage/vercel-kv)（Redis）や [Vercel Postgres](https://vercel.com/docs/storage/vercel-postgres) への移行を検討してください。

### 対応ファイル形式

| 形式 | 拡張子 |
|------|--------|
| PDF | `.pdf` |
| Word | `.docx`, `.doc` |
| テキスト | `.txt`, `.md`, `.csv` |

最大ファイルサイズ：**10MB**

## ライセンス

MIT