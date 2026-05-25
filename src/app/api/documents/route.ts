import { NextRequest, NextResponse } from "next/server";
import { getAllDocuments, deleteDocument } from "@/lib/document-store";

export const runtime = "nodejs";

/** GET /api/documents — アップロード済み文書の一覧を返す */
export async function GET() {
  try {
    const documents = await getAllDocuments();
    return NextResponse.json({ documents });
  } catch (err) {
    console.error("[documents] GET error:", err);
    return NextResponse.json(
      { error: "文書一覧の取得に失敗しました。" },
      { status: 500 }
    );
  }
}

/** DELETE /api/documents?id=xxx — 文書を削除する */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");

  if (!id) {
    return NextResponse.json(
      { error: "id が指定されていません" },
      { status: 400 }
    );
  }

  try {
    const deleted = await deleteDocument(id);
    if (!deleted) {
      // KV 未設定 + インメモリに存在しない場合もクライアント側で削除済みなので 200 を返す
      return NextResponse.json({ success: true, note: "not_found_in_store" });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[documents] DELETE error:", err);
    return NextResponse.json(
      { error: "文書の削除に失敗しました。" },
      { status: 500 }
    );
  }
}
