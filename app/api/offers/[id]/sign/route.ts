import { NextResponse } from "next/server";

import { signOffer } from "@/lib/offers/service";
import { errorToStatusCode, getErrorMessage } from "@/lib/utils/errors";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      signerName?: string;
      signatureDataUrl?: string;
    };
    const signerName = body.signerName?.trim();

    if (!signerName || !body.signatureDataUrl) {
      throw new Error("Signer name and signature are required.");
    }

    if (!/^data:image\/png;base64,[a-z0-9+/=]+$/i.test(body.signatureDataUrl)) {
      throw new Error("Signature must be a valid PNG image.");
    }

    const forwardedFor = request.headers.get("x-forwarded-for");
    const signerIp = forwardedFor?.split(",")[0]?.trim() ?? "127.0.0.1";

    const offer = await signOffer({
      offerId: id,
      signerName,
      signatureDataUrl: body.signatureDataUrl,
      signerIp,
    });

    return NextResponse.json({
      ok: true,
      offer,
    });
  } catch (error) {
    const message = getErrorMessage(error, "Unable to sign the offer.");

    return NextResponse.json(
      {
        ok: false,
        message,
      },
      { status: errorToStatusCode(error) },
    );
  }
}
