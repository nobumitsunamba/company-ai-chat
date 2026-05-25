export interface Document {
  id: string;
  name: string;
  type: string;
  size: number;
  uploadedAt: string;
  chunkCount: number;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  documentName: string;
  content: string;
  index: number;
}

/**
 * ブラウザ (localStorage) に保存するドキュメント形式。
 * チャンクを含むことで、サーバーレス環境のステートレス問題を回避する。
 */
export interface StoredDocument extends Document {
  chunks: DocumentChunk[];
}

export interface UploadError {
  message: string;   // ユーザー向けメッセージ
  detail?: string;   // エラーの詳細（例外メッセージ）
  stack?: string;    // スタックトレース（デバッグ用）
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: Date;
}
