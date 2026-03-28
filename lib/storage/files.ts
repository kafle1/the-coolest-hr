import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { slugifyFileName } from "@/lib/utils/format";
import { badRequest, notFound } from "@/lib/utils/errors";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const PDF_MIME_TYPE = "application/pdf";
const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const allowedMimeTypes = new Set([PDF_MIME_TYPE, DOCX_MIME_TYPE]);
const resumeDirectory = path.join(process.cwd(), "data", "resumes");
const offerDirectory = path.join(process.cwd(), "data", "offers");

type UploadFile = Blob & {
  name: string;
  size: number;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
};

function getResumeExtension(fileName: string) {
  return path.extname(fileName).toLowerCase();
}

export function resolveResumeMimeType(fileName: string, mimeType: string) {
  if (allowedMimeTypes.has(mimeType)) {
    return mimeType;
  }

  const extension = getResumeExtension(fileName);

  if (extension === ".pdf") {
    return PDF_MIME_TYPE;
  }

  if (extension === ".docx") {
    return DOCX_MIME_TYPE;
  }

  return null;
}

export function validateResumeFile(file: File) {
  if (!resolveResumeMimeType(file.name, file.type)) {
    throw badRequest("Please upload a PDF or DOCX resume.", "invalid_resume_type");
  }

  if (file.size > MAX_FILE_SIZE) {
    throw badRequest("Resume upload must be smaller than 5 MB.", "resume_too_large");
  }
}

async function readUploadBytes(file: UploadFile) {
  try {
    return Buffer.from(await file.arrayBuffer());
  } catch (arrayBufferError) {
    try {
      return Buffer.from(await new Response(file).arrayBuffer());
    } catch {
      throw arrayBufferError;
    }
  }
}

export async function persistResume(file: File, applicationId: string) {
  validateResumeFile(file);

  const mimeType = resolveResumeMimeType(file.name, file.type);

  if (!mimeType) {
    throw badRequest("Please upload a PDF or DOCX resume.", "invalid_resume_type");
  }

  const safeName = slugifyFileName(file.name);
  const storagePath = path.join(resumeDirectory, `${applicationId}-${safeName}`);
  const bytes = await readUploadBytes(file);

  await mkdir(resumeDirectory, { recursive: true });
  await writeFile(storagePath, bytes);

  return {
    storagePath,
    bytes,
    mimeType,
  };
}


export async function deleteStoredResume(storagePath: string) {
  await unlink(storagePath).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  });
}

export async function readStoredResume(storagePath: string) {
  const resolvedDirectory = path.resolve(resumeDirectory);
  const resolvedPath = path.resolve(storagePath);
  const relativePath = path.relative(resolvedDirectory, resolvedPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw badRequest("Stored resume path is invalid.", "invalid_resume_path");
  }

  try {
    return await readFile(resolvedPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw notFound("Stored resume file was not found.", "stored_resume_missing");
    }

    throw error;
  }
}

export async function persistOfferHtml(offerId: string, html: string) {
  const storagePath = path.join(offerDirectory, `${offerId}.html`);

  await mkdir(offerDirectory, { recursive: true });
  await writeFile(storagePath, html, "utf8");

  return storagePath;
}
