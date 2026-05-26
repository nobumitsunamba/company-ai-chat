/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Next.js がバンドルせずに外部パッケージとして扱うリスト。
    //
    // @vercel/kv: 環境変数未設定時にモジュール初期化で例外を投げるため除外。
    //
    // pdf-parse: pdfjs v1.10.100 を内包。webpack でバンドルするとパス解決が壊れるため除外。
    //            pdfjs-dist v3.x は OOM でクラッシュするため使わない。
    //
    // mammoth: ネイティブ Node.js モジュールのため除外。
    serverComponentsExternalPackages: [
      "pdf-parse",
      "pdfjs-dist",
      "mammoth",
      "@vercel/kv",
    ],

    // Vercel デプロイに必要なファイルを明示的に含める。
    // pdf-parse は内部で `./pdf.js/${version}/build/pdf.js` を動的 require するため
    // nft (Node File Tracer) が静的解析できない → 手動で含める。
    outputFileTracingIncludes: {
      "/api/documents/upload": [
        // worker thread から require('pdf-parse') を解決するために package.json が必要
        "./node_modules/pdf-parse/package.json",
        "./node_modules/pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js",
        "./node_modules/pdf-parse/lib/pdf.js/v1.10.100/build/pdf.worker.js",
        "./node_modules/pdf-parse/lib/pdf-parse.js",
      ],
    },
  },
};

export default nextConfig;
