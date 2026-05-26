/**
 * Text extraction from various file formats.
 * Supports: PDF, DOCX, TXT, MD, CSV
 *
 * PDF 抽出には pdf-parse (pdfjs v1.10.100) を使用する。
 *
 * ■ ライブラリ選択の経緯
 *   - pdfjs-dist v3.x: OOM (1.8GB) → Vercel Lambda 上限超過でクラッシュ
 *     disableFontFace: true でも OOM は解消せず (extractText 後にクラッシュ)
 *   - pdf-parse (pdfjs v1.10.100):
 *     ローカル計測 RSS +47MB、unhandledRejection も発生しない
 *     → Vercel 環境でも安定して動作する
 *
 * ■ Vercel デプロイ上の注意
 *   pdf-parse は内部で ./pdf.js/{version}/build/pdf.js を動的 require する。
 *   nft (Node File Tracer) が静的解析できないため、next.config.mjs の
 *   outputFileTracingIncludes でファイルを明示的に含める必要がある。
 *
 * ■ クラッシュ防止
 *   pdfjs の非同期クリーンアップによる unhandledRejection は
 *   route.ts のプロセスレベル永続ハンドラ（process.on('unhandledRejection')）で捕捉。
 */

export async function extractText(
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<string> {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";

  // Plain text / Markdown / CSV
  if (
    mimeType.startsWith("text/") ||
    ext === "txt" ||
    ext === "md" ||
    ext === "csv"
  ) {
    return buffer.toString("utf-8");
  }

  // PDF
  if (mimeType === "application/pdf" || ext === "pdf") {
    return extractFromPDF(buffer);
  }

  // Word (.docx)
  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === "docx"
  ) {
    return extractFromDocx(buffer);
  }

  // Word (.doc) — limited support
  if (mimeType === "application/msword" || ext === "doc") {
    return extractFromDocx(buffer);
  }

  throw new Error(`Unsupported file type: ${mimeType} (${ext})`);
}

async function extractFromPDF(buffer: Buffer): Promise<string> {
  // ── OOM 根本原因と修正方針 ─────────────────────────────────────────────────
  //
  // ■ 根本原因（Vercel OOM の真因）
  //   pdfjs v1.10.100 は起動時に global.PDFJS をそのまま内部設定として使う。
  //   (pdf.js:14173: if (!_global_scope2.default.PDFJS) { _global_scope2.default.PDFJS = {}; })
  //   つまり global.PDFJS === pdfjs 内部の PDFJS オブジェクト。
  //
  //   disableFontFace を設定しない場合、CJK CID フォントを処理する際に
  //   FontFaceObject.createFontFaceRule() が呼ばれ、以下が生成される：
  //     bytesToString(new Uint8Array(fontBinary))  → 大きな Latin-1 文字列
  //     btoa(上記文字列)                          → さらに大きな base64 文字列
  //     "@font-face { ... }" CSS ルール            → 結合された巨大文字列
  //
  //   その後 insertRule() が Node.js で document 未定義のため例外を投げ、
  //   fontReady コールバックが loadingContext.requests に残ったまま解放されない。
  //   これが 1800MB OOM の原因。
  //
  // ■ 修正
  //   require("pdf-parse") 呼び出し前に global.PDFJS に disableFontFace: true を
  //   設定する。pdfjs はモジュール初期化時に global.PDFJS を読み込むため、
  //   createFontFaceRule() が即座に null を返し、大きな文字列生成と
  //   loadingContext.requests へのリークが発生しない。
  //
  // ■ その他の設定
  //   disableAutoFetch / disableStream / disableRange:
  //     バッファ渡しでは無関係だが Range-fetch 関連の副作用を念のため抑止。
  //   disableCreateObjectURL:
  //     Node.js で URL.createObjectURL を使う試みをブロック。
  //   cMapUrl = null / cMapPacked = false:
  //     CMap 外部フェッチを即座に reject → 未完了 Promise をなくす。
  // ──────────────────────────────────────────────────────────────────────────────
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("PDF解析がタイムアウトしました（25秒超）")),
      25_000
    );
  });

  const parsePromise = (async () => {
    // pdfjs が global.PDFJS を内部 PDFJS として使うため、require より前に設定する
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = global as any;
    g.PDFJS                        = g.PDFJS || {};
    g.PDFJS.disableAutoFetch       = true;
    g.PDFJS.disableStream          = true;
    g.PDFJS.disableRange           = true;
    g.PDFJS.disableFontFace        = true;  // ← 根本修正: 大きな base64 生成を防ぐ
    g.PDFJS.disableCreateObjectURL = true;
    g.PDFJS.cMapUrl                = null;
    g.PDFJS.cMapPacked             = false;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require("pdf-parse") as (
      dataBuffer: Buffer,
      options?: { max?: number }
    ) => Promise<{ text: string; numpages: number }>;

    const result = await pdfParse(buffer, {
      max: 150, // 最大 150 ページ
    });
    return result.text;
  })();

  try {
    return await Promise.race([parsePromise, timeoutPromise]);
  } finally {
    // タイムアウトタイマーをキャンセル（unhandledRejection リーク防止）
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

async function extractFromDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

/**
 * Split extracted text into overlapping chunks.
 */
export function splitIntoChunks(
  text: string,
  chunkSize = 800,
  overlap = 100
): string[] {
  // Normalize whitespace
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (normalized.length === 0) return [];
  if (normalized.length <= chunkSize) return [normalized];

  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    let end = Math.min(start + chunkSize, normalized.length);

    // Try to break at a sentence boundary
    if (end < normalized.length) {
      const lastPeriod = normalized.lastIndexOf("。", end);
      const lastNewline = normalized.lastIndexOf("\n", end);
      const lastDot = normalized.lastIndexOf(". ", end);
      const boundary = Math.max(lastPeriod, lastNewline, lastDot);
      if (boundary > start + chunkSize / 2) {
        end = boundary + 1;
      }
    }

    chunks.push(normalized.slice(start, end).trim());
    start = end - overlap;

    // Avoid infinite loops
    if (start >= end) start = end;
  }

  return chunks.filter((c) => c.length > 0);
}
