import { format } from "date-fns";

export function formatDateTime(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  return format(date, "MMM d, yyyy 'at' h:mm a");
}

export function formatDateOnly(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  return format(date, "MMM d, yyyy");
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatStatusLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function slugifyFileName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
