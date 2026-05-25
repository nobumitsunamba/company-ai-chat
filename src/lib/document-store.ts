/**
 * In-memory document store.
 * Documents and chunks are stored in memory per Node.js process.
 * For production, replace with Vercel KV or a database.
 */

import type { Document, DocumentChunk } from "@/types";

interface DocumentStore {
  documents: Map<string, Document>;
  chunks: Map<string, DocumentChunk[]>; // documentId -> chunks
}

// Module-level singleton (persists within a single server process)
const store: DocumentStore = {
  documents: new Map(),
  chunks: new Map(),
};

export function addDocument(doc: Document, chunks: DocumentChunk[]): void {
  store.documents.set(doc.id, doc);
  store.chunks.set(doc.id, chunks);
}

export function getDocument(id: string): Document | undefined {
  return store.documents.get(id);
}

export function getAllDocuments(): Document[] {
  return Array.from(store.documents.values()).sort(
    (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
  );
}

export function deleteDocument(id: string): boolean {
  const existed = store.documents.has(id);
  store.documents.delete(id);
  store.chunks.delete(id);
  return existed;
}

export function getChunks(documentId: string): DocumentChunk[] {
  return store.chunks.get(documentId) ?? [];
}

export function getAllChunks(): DocumentChunk[] {
  const all: DocumentChunk[] = [];
  store.chunks.forEach((chunks) => {
    all.push(...chunks);
  });
  return all;
}

export function getChunksByDocumentIds(documentIds: string[]): DocumentChunk[] {
  const result: DocumentChunk[] = [];
  for (const id of documentIds) {
    const chunks = store.chunks.get(id);
    if (chunks) result.push(...chunks);
  }
  return result;
}
