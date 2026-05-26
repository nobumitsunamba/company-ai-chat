/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Next.js がバンドルせずに外部パッケージとして扱うリスト。
    //
    // @vercel/kv: 環境変数未設定時にモジュール初期化で例外を投げるため除外。
    //            isKVReady() チェック後にのみ動的 import させることで回避。
    //
    // pdfjs-dist: legacy ビルド (legacy/build/pdf.js) を Node.js で使用。
    //             CJS 互換ビルドのため require() で読み込む。
    //             webpack でバンドルすると内部パス解決が壊れるため外部扱い必須。
    //
    // mammoth: ネイティブ Node.js モジュールのため除外。
    serverComponentsExternalPackages: [
      "pdfjs-dist",
      "mammoth",
      "@vercel/kv",
    ],

    // Vercel デプロイに必要なファイルを明示的に含める。
    // pdfjs-dist/legacy/build/pdf.js は require() で動的に読み込むため
    // nft (Node File Tracer) が静的解析で追跡できない場合がある。
    // → outputFileTracingIncludes で強制的に含める。
    outputFileTracingIncludes: {
      "/api/documents/upload": [
        "./node_modules/pdfjs-dist/legacy/build/pdf.js",
        "./node_modules/pdfjs-dist/legacy/build/pdf.worker.js",
      ],
    },
  },
};

export default nextConfig;
