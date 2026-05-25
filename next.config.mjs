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
  },
};

export default nextConfig;
