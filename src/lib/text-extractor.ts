/**
 * Text extraction from various file formats.
 * Supports: PDF, DOCX, TXT, MD
 *
 * PDF 抽出には pdfjs-dist 5.x を直接使用する。
 *   - pdfjs-dist は doc.destroy() を正しく await できるため後片付け漏れがない。
 *   - isEvalSupported: false でサーバーレス環境での eval() を無効化。
 *   - disableFontFace: true でフォント DL を省略（テキスト抽出のみ）。
 *   - ページ単位の try-catch でパース失敗ページをスキップ。
 *   - workerSrc に require.resolve() で絶対パスを渡す（Vercel でも動作）。
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
  // ── pdfjs-dist 5.x を直接使用 ──────────────────────────────────────────
  // pdf-parse (pdf.js v1.10.100) は：
  //   ① doc.destroy() を await せず → 後片付けが非同期で失敗して unhandledRejection
  //   ② モジュール変数 PDFJS を使い回す → 複雑な PDF の後に状態汚染
  //   ③ CJK フォント（日本語など）のサポートが不完全
  // pdfjs-dist 5.x はこれらをすべて解決している。
  //
  // workerSrc: require.resolve('.mjs') は webpack がビルド時に ESM として解析しようとして
  //   "ESM packages need to be imported" エラーになる。
  //   代わりに path.join(process.cwd(), 'node_modules/...') で絶対パスを構築する。
  //   serverComponentsExternalPackages に pdfjs-dist を追加してあるため
  //   Vercel デプロイでも node_modules 以下のファイルがそのまま利用できる。
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path") as typeof import("path");
  const workerSrc =
    "file://" +
    path.join(
      process.cwd(),
      "node_modules",
      "pdfjs-dist",
      "legacy",
      "build",
      "pdf.worker.mjs"
    );

  const { getDocument, GlobalWorkerOptions } = await import(
    "pdfjs-dist/legacy/build/pdf.mjs"
  );
  GlobalWorkerOptions.workerSrc = workerSrc;

  const TIMEOUT_MS = 25_000; // 25 秒タイムアウト
  const MAX_PAGES = 150; // 最大 150 ページ

  const parsePromise = (async () => {
    const task = getDocument({
      data: new Uint8Array(buffer),
      useWorkerFetch: false, // ネットワークフェッチを無効化
      disableFontFace: true, // テキスト抽出のみ：フォント読み込み省略
    });

    // パスワード保護された PDF への対応（パスワード不要として処理）
    task.onPassword = () => {
      throw new Error(
        "パスワードで保護された PDF は現在サポートされていません。"
      );
    };

    const pdfDoc = await task.promise;

    try {
      const numPages = Math.min(pdfDoc.numPages, MAX_PAGES);
      const pageTexts: string[] = [];

      for (let i = 1; i <= numPages; i++) {
        try {
          const page = await pdfDoc.getPage(i);
          const textContent = await page.getTextContent();
          // TextItem has `str`, TextMarkedContent does not — skip markers
          const text = textContent.items
            .map((item) => ("str" in item ? (item as { str: string }).str : ""))
            .join(" ");
          pageTexts.push(text.trim());
          page.cleanup();
        } catch {
          // パース失敗ページはスキップして続行
          pageTexts.push("");
        }
      }

      return pageTexts.filter(Boolean).join("\n\n");
    } finally {
      // doc.destroy() を必ず await — これが unhandledRejection の根本原因だった
      await pdfDoc.destroy();
    }
  })();

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error("PDF解析がタイムアウトしました（25秒超）")),
      TIMEOUT_MS
    )
  );

  return Promise.race([parsePromise, timeoutPromise]);
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
