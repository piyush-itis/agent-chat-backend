export type TimeIdCursor = {
  createdAt: Date;
  id: string;
};

export function encodeCursor(value: TimeIdCursor): string {
  return Buffer.from(`${value.createdAt.toISOString()}|${value.id}`, "utf8").toString(
    "base64url",
  );
}

export function decodeCursor(raw: string | null): TimeIdCursor | null {
  if (!raw) return null;
  try {
    const text = Buffer.from(raw, "base64url").toString("utf8");
    const sep = text.indexOf("|");
    if (sep === -1) return null;
    const createdAt = new Date(text.slice(0, sep));
    const id = text.slice(sep + 1);
    if (Number.isNaN(createdAt.getTime()) || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}
