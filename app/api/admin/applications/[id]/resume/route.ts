import { NextResponse } from "next/server";

import { getApplicationResumeAsset } from "@/lib/applications/service";
import { readStoredResume } from "@/lib/storage/files";
import { errorToStatusCode, getErrorMessage } from "@/lib/utils/errors";

function sanitizeFileName(fileName: string) {
  return fileName.replace(/["\r\n]/g, "");
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const resumeAsset = await getApplicationResumeAsset(id);
    const resumeBytes = await readStoredResume(resumeAsset.storagePath);
    const shouldDownload =
      new URL(request.url).searchParams.get("download") === "1";

    return new NextResponse(new Uint8Array(resumeBytes), {
      headers: {
        "Content-Disposition": `${shouldDownload ? "attachment" : "inline"}; filename="${sanitizeFileName(resumeAsset.originalName)}"`,
        "Content-Length": String(resumeBytes.byteLength),
        "Content-Type": resumeAsset.mimeType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = getErrorMessage(error, "Unable to load the stored resume.");

    return NextResponse.json(
      { ok: false, message },
      {
        status: errorToStatusCode(error),
      },
    );
  }
}
