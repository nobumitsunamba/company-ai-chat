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

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: Date;
}
