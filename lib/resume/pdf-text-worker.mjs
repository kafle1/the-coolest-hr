import { Buffer } from "node:buffer";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

function normalizeExtractedText(value) {
  return value.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function readStdin() {
  const chunks = [];

  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  }

  return chunks.join("").trim();
}

async function extractPdfText(bytes) {
  const pdfJsModuleUrl = pathToFileURL(
    join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.mjs"),
  ).href;
  const workerUrl = pathToFileURL(
    join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs"),
  ).href;
  const standardFontDataPath = join(
    process.cwd(),
    "node_modules",
    "pdfjs-dist",
    "standard_fonts",
  );
  const pdfjs = await import(pdfJsModuleUrl);

  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const document = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    isEvalSupported: false,
    standardFontDataUrl: standardFontDataPath.endsWith("/")
      ? standardFontDataPath
      : `${standardFontDataPath}/`,
  }).promise;

  try {
    const pages = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);

      try {
        const content = await page.getTextContent();
        const pageText = content.items
          .map((item) => ("str" in item && typeof item.str === "string" ? item.str.trim() : ""))
          .filter(Boolean)
          .join(" ");

        if (pageText) {
          pages.push(pageText);
        }
      } finally {
        page.cleanup();
      }
    }

    return normalizeExtractedText(pages.join("\n\n"));
  } finally {
    await document.destroy();
  }
}

try {
  const input = await readStdin();
  const bytes = Buffer.from(input, "base64");
  const text = await extractPdfText(bytes);

  process.stdout.write(JSON.stringify({ text }));
} catch (error) {
  const message = error instanceof Error ? error.message : "Unable to extract PDF text.";

  process.stderr.write(message);
  process.exitCode = 1;
}
