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
  // ── pdf-parse でインライン解析（worker ファイル不要）─────────────────────
  //
  // タイムアウトタイマーの参照を保持し finally で必ず clearTimeout する。
  // clearTimeout しないと 25 秒後に reject() が発火して unhandledRejection になる。
  // ──────────────────────────────────────────────────────────────────────────────
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("PDF解析がタイムアウトしました（25秒超）")),
      25_000
    );
  });

  const parsePromise = (async () => {
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
