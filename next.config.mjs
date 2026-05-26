/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Next.js がバンドルせずに外部パッケージとして扱うリスト。
    // @vercel/kv は環境変数未設定時にモジュール初期化で例外を投げるため
    // バンドルから除外してランタイムで require させる。
    // pdf-parse, pdfjs-dist: バンドルするとワーカーファイルが欠落して実行時エラー。
    // pdfjs-dist 3.x (CJS) を外部パッケージ扱いにすることで
    // build/pdf.worker.js が Vercel 成果物に含まれ require.resolve() で参照できる。
    // ※ 5.x は DOMMatrix 等 browser-only API が必要で Node.js/Vercel では動かない。
    serverComponentsExternalPackages: [
      "pdf-parse",
      "pdfjs-dist",
      "mammoth",
      "@vercel/kv",
    ],

    // pdfjs-dist の pdf.worker.js を Vercel デプロイに明示的に含める。
    //
    // 問題: Vercel の nft（node-file-tracer）は静的な require() しか追跡しない。
    //       pdf.worker.js は GlobalWorkerOptions.workerSrc に実行時動的セットされるため
    //       nft に検出されず、Vercel サーバーレス関数バンドルに含まれない。
    //       その結果 /var/task/node_modules/pdfjs-dist/build/pdf.worker.js が存在せず
    //       "Setting up fake worker failed: Cannot find module" エラーが発生する。
    //
    // 解決: outputFileTracingIncludes でワーカーファイルを強制的に含める。
    //       これにより pdf.worker.js が /var/task/node_modules/pdfjs-dist/build/ に
    //       配置され、path.join(process.cwd(), ...) で参照できるようになる。
    outputFileTracingIncludes: {
      "/api/documents/upload": [
        "./node_modules/pdfjs-dist/build/pdf.worker.js",
        "./node_modules/pdfjs-dist/build/pdf.worker.js.map",
      ],
    },
  },
};

export default nextConfig;
