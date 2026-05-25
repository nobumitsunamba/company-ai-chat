/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Next.js がバンドルせずに外部パッケージとして扱うリスト。
    // @vercel/kv は環境変数未設定時にモジュール初期化で例外を投げるため
    // バンドルから除外してランタイムで require させる。
    serverComponentsExternalPackages: ["pdf-parse", "mammoth", "@vercel/kv"],
  },
};

export default nextConfig;
