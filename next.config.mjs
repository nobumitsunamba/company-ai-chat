/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Next.js がバンドルせずに外部パッケージとして扱うリスト。
    //
    // @vercel/kv: 環境変数未設定時にモジュール初期化で例外を投げるため除外。
    //            isKVReady() チェック後にのみ動的 import させることで回避。
    //
    // pdf-parse: pdfjs v2.x を内包し workerSrc=false のインラインモードで動作。
    //            webpack でバンドルするとパス解決が壊れるため除外。
    //            pdf.worker.js などの別途ファイルは不要（Vercel バンドル問題を回避）。
    //
    // pdfjs-dist: pdf-parse が内部で依存するため外部パッケージ扱いを維持。
    //             ※ pdfjs-dist を直接使うと以下の問題がある:
    //               - pdf.worker.js を Vercel バンドルに含めるのが困難
    //               - フェイクワーカークリーンアップが unhandledRejection を発生させる
    //               - 同一プロセス内の2回目呼び出しでワーカー状態が汚染される
    //
    // mammoth: ネイティブ Node.js モジュールのため除外。
    serverComponentsExternalPackages: [
      "pdf-parse",
      "pdfjs-dist",
      "mammoth",
      "@vercel/kv",
    ],
  },
};

export default nextConfig;
