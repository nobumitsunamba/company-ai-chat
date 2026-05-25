/**
 * Vercel KV (Upstash Redis) バックエンドのドキュメントストア。
 *
 * 環境変数 KV_REST_API_URL + KV_REST_API_TOKEN が両方設定されていれば KV を使用。
 * 未設定時はインメモリにフォールバック（ローカル開発・KV 未設定時）。
 *
 * 注意：
 *   @vercel/kv v2 は環境変数が未設定の状態でモジュールを require/import すると
 *   初期化時に例外を投げる。そのため next.config.mjs で
 *   serverComponentsExternalPackages に追加し、バンドルを避けている。
 *   さらに isKVReady() チェック後にのみ動的 import させることで
 *   未設定環境での例外を完全に回避する。
 *
 * KV キー設計:
 *   cai:docs:index    → Sorted Set (score = uploadedAt ms, member = docId)
 *   cai:doc:{id}      → Document メタデータ
 *   cai:chunks:{id}   → DocumentChunk[]
 */

import type { Document, DocumentChunk } from "@/types";

// ─── KV キー ─────────────────────────────────────────────────────────────────

const P = "cai";
const INDEX_KEY = `${P}:docs:index`;
const docKey = (id: string) => `${P}:doc:${id}`;
const chunksKey = (id: string) => `${P}:chunks:${id}`;

// ─── KV 可用性チェック ────────────────────────────────────────────────────────

function isKVReady(): boolean {
  // KV_URL または REST API の両方が揃っているときのみ有効
  return !!(
    process.env.KV_URL ||
    (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
  );
}

// KV クライアントのキャッシュ（同一インスタンス内で再利用）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _kv: any = null;

/**
 * KV クライアントを取得する。
 * - 環境変数が未設定 → null を返す（インメモリフォールバックを使う）
 * - 環境変数が設定済み → @vercel/kv を動的 import して kv を返す
 * - import/初期化失敗 → null を返す（エラーは console に出力）
 */
async function tryGetKV(): Promise<typeof _kv | null> {
  if (!isKVReady()) return null;
  if (_kv) return _kv; // キャッシュ済み

  try {
    // next.config.mjs で serverComponentsExternalPackages に @vercel/kv を追加済み。
    // isKVReady() が true のとき（= env var が設定済み）のみここに到達するため
    // @vercel/kv の初期化例外は発生しない。
    const mod = await import("@vercel/kv");
    _kv = mod.kv;
    return _kv;
  } catch (e) {
    console.error("[document-store] @vercel/kv import/init failed:", e);
    return null;
  }
}

// ─── インメモリフォールバック（ローカル開発 / KV 未設定時） ────────────────────

const mem = {
  docs: new Map<string, Document>(),
  chunks: new Map<string, DocumentChunk[]>(),
};

// ─── Public API（全て非同期） ─────────────────────────────────────────────────

export async function addDocument(
  doc: Document,
  chunks: DocumentChunk[]
): Promise<void> {
  const kv = await tryGetKV();

  if (kv) {
    try {
      await Promise.all([
        kv.set(docKey(doc.id), doc),
        kv.set(chunksKey(doc.id), chunks),
        kv.zadd(INDEX_KEY, {
          score: new Date(doc.uploadedAt).getTime(),
          member: doc.id,
        }),
      ]);
      return;
    } catch (e) {
      console.error("[document-store] KV write failed, using in-memory:", e);
    }
  } else {
    console.warn(
      "[document-store] KV not configured – using in-memory store (data lost on restart)"
    );
  }

  mem.docs.set(doc.id, doc);
  mem.chunks.set(doc.id, chunks);
}

export async function getAllDocuments(): Promise<Document[]> {
  const kv = await tryGetKV();

  if (kv) {
    try {
      const ids = (await kv.zrange(INDEX_KEY, 0, -1, {
        rev: true,
      })) as string[];
      if (ids.length === 0) return [];

      const docs: (Document | null)[] = await Promise.all(
        ids.map((id: string) => kv.get(docKey(id)) as Promise<Document | null>)
      );
      return docs.filter((d): d is Document => d !== null);
    } catch (e) {
      console.error("[document-store] KV read failed:", e);
    }
  }

  return Array.from(mem.docs.values()).sort(
    (a, b) =>
      new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
  );
}

export async function deleteDocument(id: string): Promise<boolean> {
  const kv = await tryGetKV();

  if (kv) {
    try {
      const results = await Promise.all([
        kv.del(docKey(id)),
        kv.del(chunksKey(id)),
        kv.zrem(INDEX_KEY, id),
      ]);
      return results.some((r: number) => r > 0);
    } catch (e) {
      console.error("[document-store] KV delete failed:", e);
    }
  }

  const existed = mem.docs.has(id);
  mem.docs.delete(id);
  mem.chunks.delete(id);
  return existed;
}

export async function getChunks(documentId: string): Promise<DocumentChunk[]> {
  const kv = await tryGetKV();

  if (kv) {
    try {
      const chunks = (await kv.get(chunksKey(documentId))) as DocumentChunk[] | null;
      return chunks ?? [];
    } catch (e) {
      console.error("[document-store] KV chunk read failed:", e);
    }
  }

  return mem.chunks.get(documentId) ?? [];
}

export async function getAllChunks(): Promise<DocumentChunk[]> {
  const docs = await getAllDocuments();
  const nested = await Promise.all(docs.map((d) => getChunks(d.id)));
  return nested.flat();
}

export async function getChunksByDocumentIds(
  documentIds: string[]
): Promise<DocumentChunk[]> {
  const nested = await Promise.all(documentIds.map((id) => getChunks(id)));
  return nested.flat();
}
