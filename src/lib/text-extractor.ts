/**
 * Text extraction from various file formats.
 * Supports: PDF, DOCX, TXT, MD
 */

export async function extractText(
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<string> {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";

  // Plain text / Markdown
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
  // pdf-parse の index.js はインポート時にテストファイルを読み込もうとする。
  // Vercel のサーバーレス環境ではテストファイルが存在しないためエラーになるため、
  // テストコードを含まない内部パスを直接 require する。
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require("pdf-parse/lib/pdf-parse");

  // ── unhandledRejection 対策 ──────────────────────────────────────────────
  // pdf-parse 内部の pdf.js は `doc.destroy()` を await せずに呼ぶため、
  // 複雑な PDF（フォント・リソースが多いもの）の後片付け処理が非同期で失敗すると
  // unhandledRejection がプロセスレベルに浮上し、Node 15+ ではプロセスがクラッシュ
  // して Vercel が HTML 500 を返してしまう。
  // パース処理の間だけリジェクションを吸収するリスナーを一時的に登録することで
  // プロセスのクラッシュを防ぐ。
  const rejectionAbsorber = (reason: unknown) => {
    console.warn(
      "[pdf-extract] Absorbed unhandledRejection during PDF parsing:",
      reason
    );
  };
  process.on("unhandledRejection", rejectionAbsorber);

  try {
    // 25 秒タイムアウト + 最大 150 ページ制限（巨大 PDF によるハングアップ防止）
    const TIMEOUT_MS = 25_000;

    const parsePromise: Promise<{ text: string }> = pdfParse(buffer, {
      max: 150,
    });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("PDF解析がタイムアウトしました（25秒超）")),
        TIMEOUT_MS
      )
    );

    const result = await Promise.race([parsePromise, timeoutPromise]);

    // pdf-parse は `doc.destroy()` を await せずに return するため、
    // パース完了直後に内部クリーンアップの unhandledRejection が発火することがある。
    // 200ms 待機してクリーンアップが落ち着いてからリスナーを解除する。
    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    return result.text;
  } finally {
    // 成功・失敗を問わず必ずリスナーを解除する
    process.removeListener("unhandledRejection", rejectionAbsorber);
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
