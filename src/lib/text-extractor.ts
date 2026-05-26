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
  // ── pdfjs-dist 3.x を直接使用 ──────────────────────────────────────────
  // pdf-parse (pdf.js v1.10.100) の問題点：
  //   ① doc.destroy() を await せず → 後片付けが非同期で失敗して unhandledRejection
  //   ② モジュール変数 PDFJS を使い回す → 複雑な PDF 後に状態汚染
  //   ③ CJK フォント（日本語）のサポートが不完全
  //
  // pdfjs-dist 5.x は DOMMatrix など browser-only API を必要とし Node.js では動かない。
  // pdfjs-dist 3.x は CJS 形式で DOMMatrix 不要、Node.js/Vercel で安定動作する。
  //
  // workerSrc: 3.x は .js (CJS) なので require.resolve が使える
  //   (webpack が ESM として拒否しない)。
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfjs = require("pdfjs-dist/build/pdf.js") as {
    getDocument: (params: {
      data: Uint8Array;
      useWorkerFetch?: boolean;
      disableFontFace?: boolean;
    }) => {
      promise: Promise<{
        numPages: number;
        getPage: (n: number) => Promise<{
          getTextContent: () => Promise<{
            items: Array<{ str?: string }>;
          }>;
          cleanup: () => void;
        }>;
        destroy: () => Promise<void>;
      }>;
      onPassword: ((fn: () => void) => void) | null;
    };
    GlobalWorkerOptions: { workerSrc: string };
  };

  // workerSrc: require.resolve() は webpack がビルド時に module ID（数値）へ置換するため
  // pdfjs の内部で .endsWith() を呼ぶと "not a function" エラーになる。
  // path.join(process.cwd(), ...) はビルド時に静的解析されず、実行時に正しい絶対パスを返す。
  // Vercel での process.cwd() は /var/task（プロジェクトルート）。
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePath = require("path") as typeof import("path");
  pdfjs.GlobalWorkerOptions.workerSrc = nodePath.join(
    process.cwd(),
    "node_modules",
    "pdfjs-dist",
    "build",
    "pdf.worker.js"
  );

  const TIMEOUT_MS = 25_000; // 25 秒タイムアウト
  const MAX_PAGES = 150; // 最大 150 ページ

  const parsePromise = (async () => {
    const task = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useWorkerFetch: false, // ネットワークフェッチを無効化
      disableFontFace: true, // テキスト抽出のみ：フォント読み込み省略
    });

    const pdfDoc = await task.promise;

    try {
      const numPages = Math.min(pdfDoc.numPages, MAX_PAGES);
      const pageTexts: string[] = [];

      for (let i = 1; i <= numPages; i++) {
        try {
          const page = await pdfDoc.getPage(i);
          const textContent = await page.getTextContent();
          const text = textContent.items
            .map((item) => item.str ?? "")
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
      // doc.destroy() を必ず await（pdf-parse が await しないため問題だった）
      await pdfDoc.destroy();
    }
  })();

  // タイムアウトタイマーの参照を保持し、必ず clearTimeout する。
  //
  // 【重要】Promise.race に渡した timeoutPromise は、parsePromise が先に
  // 終了（成功・失敗問わず）した後も 25 秒タイマーが残り続ける。
  // clearTimeout しないと setTimeout コールバックが 25 秒後に reject() を
  // 呼び出し、誰も await していない Promise が拒否される → unhandledRejection。
  // Node.js 15+ はデフォルトで unhandledRejection をプロセス終了扱いにするため
  // サーバーレス関数がクラッシュし、次リクエストが 500 HTML になる原因となる。
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("PDF解析がタイムアウトしました（25秒超）")),
      TIMEOUT_MS
    );
  });

  try {
    return await Promise.race([parsePromise, timeoutPromise]);
  } finally {
    // parsePromise が先に終了した場合: タイマーをキャンセルして unhandledRejection を防ぐ
    // timeoutPromise が先に終了した場合: タイマーはすでに発火済みなので clearTimeout は無害
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
