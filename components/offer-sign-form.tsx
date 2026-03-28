"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

export function OfferSignForm({ offerId }: { offerId: string }) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const hasSignatureRef = useRef(false);
  const [signerName, setSignerName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.lineWidth = 2;
    context.lineCap = "round";
    context.strokeStyle = "#0f172a";
  }, []);

  function getCoordinates(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();

    return {
      x: ((event.clientX - rect.left) / rect.width) * event.currentTarget.width,
      y: ((event.clientY - rect.top) / rect.height) * event.currentTarget.height,
    };
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !context) {
      return;
    }

    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    hasSignatureRef.current = false;
  }

  return (
    <div className="surface-panel grid gap-4 p-4">
      <label className="grid gap-2 text-sm font-semibold">
        Full legal name
        <input className="field" onChange={(event) => setSignerName(event.target.value)} value={signerName} />
      </label>

      <div>
        <p className="mb-2 text-sm font-semibold">Signature</p>
        <canvas
          ref={canvasRef}
          className="w-full rounded-[24px] border border-black/10 bg-white"
          height={160}
          onPointerDown={(event) => {
            const canvas = canvasRef.current;
            const context = canvas?.getContext("2d");

            if (!canvas || !context) {
              return;
            }

            const point = getCoordinates(event);
            drawingRef.current = true;
            hasSignatureRef.current = true;
            context.beginPath();
            context.moveTo(point.x, point.y);
          }}
          onPointerMove={(event) => {
            if (!drawingRef.current) {
              return;
            }

            const canvas = canvasRef.current;
            const context = canvas?.getContext("2d");

            if (!canvas || !context) {
              return;
            }

            const point = getCoordinates(event);
            context.lineTo(point.x, point.y);
            context.stroke();
          }}
          onPointerUp={() => {
            drawingRef.current = false;
          }}
          onPointerLeave={() => {
            drawingRef.current = false;
          }}
          width={640}
        />
        <button className="button-secondary mt-3" onClick={clearCanvas} type="button">
          Clear signature
        </button>
      </div>

      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

      <button
        className="button-primary w-full sm:w-fit"
        disabled={isPending}
        onClick={() => {
          const canvas = canvasRef.current;

          if (!canvas) {
            return;
          }

          setError(null);
          setMessage(null);

          startTransition(async () => {
            try {
              const trimmedSignerName = signerName.trim();

              if (!trimmedSignerName) {
                throw new Error("Your full name is required.");
              }

              if (!hasSignatureRef.current) {
                throw new Error("Please draw your signature before signing.");
              }

              const signatureDataUrl = canvas.toDataURL("image/png");
              const response = await fetch(`/api/offers/${offerId}/sign`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  signerName: trimmedSignerName,
                  signatureDataUrl,
                }),
              });
              const payload = (await response.json()) as {
                message?: string;
                onboardingUrl?: string | null;
              };

              if (!response.ok) {
                throw new Error(payload.message ?? "Unable to sign offer.");
              }

              setMessage(payload.message ?? "Offer signed successfully.");
              router.refresh();

              if (payload.onboardingUrl) {
                window.location.assign(payload.onboardingUrl);
              }
            } catch (submissionError) {
              setError(
                submissionError instanceof Error
                  ? submissionError.message
                  : "Unable to sign offer.",
              );
            }
          });
        }}
        type="button"
      >
        {isPending ? "Signing..." : "Sign offer"}
      </button>
    </div>
  );
}
