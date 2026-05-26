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
  // ■ 根本原因①（単発 OOM）
  //   pdfjs v1.10.100 は起動時に global.PDFJS をそのまま内部設定として使う。
  //   (pdf.js:14173: if (!_global_scope2.default.PDFJS) { _global_scope2.default.PDFJS = {}; })
  //   つまり global.PDFJS === pdfjs 内部の PDFJS オブジェクト。
  //
  //   disableFontFace を設定しない場合、CJK CID フォントを処理する際に
  //   FontFaceObject.createFontFaceRule() が呼ばれ、以下が生成される：
  //     bytesToString(new Uint8Array(fontBinary))  → 大きな Latin-1 文字列
  //     btoa(上記文字列)                          → さらに大きな base64 文字列
  //     "@font-face { ... }" CSS ルール            → 結合された巨大文字列
  //   その後 insertRule() が Node.js で document 未定義のため例外を投げ、
  //   fontReady コールバックが loadingContext.requests に残ったまま解放されない。
  //
  // ■ 根本原因②（ウォーム Lambda 累積 OOM）
  //   pdf-parse は内部で doc.destroy() を await せずに呼ぶ（fire-and-forget）。
  //   そのため WorkerTransport / commonObjs / fontLoader などが非同期クリーンアップ待ち
  //   のままリクエストをまたいで蓄積し、複数リクエスト後に OOM に達する。
  //
  // ■ 解決策：worker_threads による完全メモリ分離
  //   pdf-parse を独立した worker thread で実行する。
  //   - worker thread は独自のモジュールキャッシュを持つため、global.PDFJS を
  //     require('pdf-parse') より前に設定することで disableFontFace が確実に適用される。
  //   - worker.terminate() 呼び出し時にスレッドのヒープ全体が解放されるため、
  //     doc.destroy() の未完了 Promise に関わらず累積リークが発生しない。
  //   - pdfParsePath は require.resolve() で解決した絶対パスを渡し、
  //     worker thread 内でのモジュール解決の曖昧さをなくす。
  //
  // ■ その他の設定
  //   disableAutoFetch / disableStream / disableRange:
  //     バッファ渡しでは無関係だが Range-fetch 関連の副作用を念のため抑止。
  //   disableCreateObjectURL:
  //     Node.js で URL.createObjectURL を使う試みをブロック。
  //   cMapUrl = null / cMapPacked = false:
  //     CMap 外部フェッチを即座に reject → 未完了 Promise をなくす。
  // ──────────────────────────────────────────────────────────────────────────────

  const { Worker } = await import("worker_threads");

  // Worker コード：eval: true で worker thread 内でインライン実行される
  const WORKER_CODE = `
const { workerData, parentPort } = require('worker_threads');
(async () => {
  try {
    // worker thread は独自のモジュールキャッシュを持つため、require より前に設定すれば
    // pdfjs モジュール初期化時（pdf.js:1981 globalSettings スナップショット）に確実に反映される
    const g = global;
    g.PDFJS                        = g.PDFJS || {};
    g.PDFJS.disableAutoFetch       = true;
    g.PDFJS.disableStream          = true;
    g.PDFJS.disableRange           = true;
    g.PDFJS.disableFontFace        = true;   // CJK base64 巨大文字列生成を防ぐ
    g.PDFJS.disableCreateObjectURL = true;
    g.PDFJS.cMapUrl                = null;
    g.PDFJS.cMapPacked             = false;

    // worker thread 内では require は Node.js ネイティブのため
    // パッケージ名で直接 require できる（webpack シムの影響を受けない）
    const pdfParse = require('pdf-parse');
    const buf = Buffer.from(workerData.pdfBuffer);
    const result = await pdfParse(buf, { max: 150 });
    parentPort.postMessage({ ok: true, text: result.text });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
})();
`;

  // Buffer の実体部分だけを ArrayBuffer としてコピー
  // （buffer.buffer は Node.js のプール領域全体を指す場合があるため slice が必要）
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;

  return new Promise<string>((resolve, reject) => {
    const worker = new Worker(WORKER_CODE, {
      eval: true,
      workerData: {
        pdfBuffer: arrayBuffer,
        // NOTE: require.resolve("pdf-parse") は webpack シムにより数値 ID を返すため使用不可。
        // worker thread 内の require は Node.js ネイティブなので 'pdf-parse' で直接解決する。
      },
    });

    let settled = false;
    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeoutId);
        // terminate() でスレッドヒープを即時解放
        worker.terminate().catch(() => {});
        fn();
      }
    };

    const timeoutId = setTimeout(() => {
      settle(() => reject(new Error("PDF解析がタイムアウトしました（25秒超）")));
    }, 25_000);

    worker.once("message", (msg: { ok: boolean; text?: string; error?: string }) => {
      settle(() => {
        if (msg.ok) resolve(msg.text ?? "");
        else reject(new Error(msg.error ?? "PDF parse failed"));
      });
    });

    worker.once("error", (err) => settle(() => reject(err)));

    worker.once("exit", (code) => {
      // 0 = 正常終了、1 = terminate() による強制終了（どちらも想定内）
      // それ以外の予期しないコードのみ reject する
      if (code !== 0 && code !== 1) {
        settle(() =>
          reject(new Error(`PDF worker が予期しないコードで終了しました: ${code}`))
        );
      }
    });
  });
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
