/**
 * Text extraction from various file formats.
 * Supports: PDF, DOCX, TXT, MD, CSV
 *
 * PDF 抽出には pdfjs-dist/legacy/build/pdf.js を使用する。
 *
 * ■ なぜ legacy ビルドを使うのか
 *   - pdfjs-dist の標準ビルド (build/pdf.js) は Web Worker を前提としており、
 *     Node.js 環境では "Setting up fake worker failed" エラーになる。
 *   - legacy ビルドは CJS 互換で、Node.js を自動検出してメインスレッドで動作する。
 *   - pdf-parse (pdfjs v1.10.100) は古く、特定の PDF (CID フォント 2 フォント使用等) で
 *     Vercel 環境のみ失敗するケースがあった。legacy v3.11.x では解消されている。
 *
 * ■ 注意点
 *   - canvas モジュールは不要（テキスト抽出のみ）。
 *     起動時の Warning は無害なので verbosity=0 で抑制する。
 *   - 各 PDF 処理後に doc.cleanup() + doc.destroy() を呼び、
 *     リソースリークや unhandledRejection を防ぐ。
 *   - タイムアウト Promise は必ず clearTimeout して
 *     タイマー由来の unhandledRejection を防ぐ。
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
  // ── pdfjs-dist legacy ビルドで PDF テキスト抽出 ────────────────────────────
  //
  // legacy ビルドは Node.js を自動検出してメインスレッドで動作する。
  // ワーカー設定不要。canvas 不要（テキスト抽出のみ）。
  //
  // タイムアウトタイマーの参照を保持し finally で必ず clearTimeout する。
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
    const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js") as {
      getDocument: (params: {
        data: Uint8Array;
        useSystemFonts: boolean;
        verbosity: number;
      }) => { promise: Promise<PDFDocument> };
    };

    type PDFDocument = {
      numPages: number;
      getPage: (n: number) => Promise<PDFPage>;
      cleanup: () => Promise<void>;
      destroy: () => Promise<void>;
    };
    type PDFPage = {
      getTextContent: () => Promise<{ items: Array<{ str: string; hasEOL?: boolean }> }>;
      cleanup: () => Promise<void>;
    };

    const task = pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,  // システムフォントを使用（CMaps 取得不要）
      verbosity: 0,           // canvas 関連 Warning を抑制
    });

    const doc = await task.promise;
    let text = "";

    try {
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        try {
          const content = await page.getTextContent();
          for (const item of content.items) {
            text += item.str;
            if (item.hasEOL) text += "\n";
          }
        } finally {
          await page.cleanup().catch(() => {});
        }
      }
    } finally {
      await doc.cleanup().catch(() => {});
      await doc.destroy().catch(() => {});
    }

    return text;
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
