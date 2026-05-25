/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Next.js がバンドルせずに外部パッケージとして扱うリスト。
    // @vercel/kv は環境変数未設定時にモジュール初期化で例外を投げるため
    // バンドルから除外してランタイムで require させる。
    // pdf-parse, pdfjs-dist: バンドルするとワーカーファイルが欠落して実行時エラー。
    // pdfjs-dist を外部パッケージ扱いにすることで legacy/build/pdf.worker.mjs が
    // Vercel デプロイ成果物に含まれ、require.resolve() で実行時に参照できる。
    serverComponentsExternalPackages: [
      "pdf-parse",
      "pdfjs-dist",
      "mammoth",
      "@vercel/kv",
    ],
  },
};

export default nextConfig;
