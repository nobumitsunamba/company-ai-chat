/**
 * Text extraction from various file formats.
 * Supports: PDF, DOCX, TXT, MD, CSV
 *
 * PDF 抽出には pdf-parse を使用する。
 *   - pdf-parse は pdfjs v2.x を内包し workerSrc=false のインラインモードで動作
 *     → 別途 pdf.worker.js ファイルが不要（Vercel バンドル問題を完全回避）
 *   - pdfjs-dist 3.x を直接使う場合の問題点:
 *       ① nft が pdf.worker.js への動的参照を追跡できず Vercel デプロイに含まれない
 *       ② フェイクワーカーのクリーンアップが unhandledRejection を発生させる
 *          → Node.js 15+ がプロセスを終了 → 2ファイル目から 500 HTML になる
 *       ③ 同一プロセス内の2回目以降の呼び出しでワーカー状態が汚染される場合がある
 *   - pdf-parse も内部 pdfjs のクリーンアップで unhandledRejection を発生させることがある
 *     → PDF 解析中のみスコープ付きハンドラで吸収してプロセスクラッシュを防ぐ
 *   - タイムアウト Promise は必ず clearTimeout して unhandledRejection リークを防ぐ
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
  // pdf-parse は pdfjs v2.x を内包し workerSrc=false のインラインモードで動作。
  // pdfjs の非同期クリーンアップによる unhandledRejection は
  // route.ts のプロセスレベル永続ハンドラで捕捉される。
  //
  // タイムアウトタイマーの参照を保持し、finally で必ず clearTimeout する。
  // clearTimeout しないと 25 秒後に reject() が発火して unhandledRejection になる。
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
