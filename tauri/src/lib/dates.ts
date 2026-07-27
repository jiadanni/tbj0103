export function formatTimestamp(value?: string | null): string {
  if (!value) { return ""; }
  try {
    const d = new Date(value.endsWith("Z") || value.includes("+") ? value : `${value}Z`);
    if (isNaN(d.getTime())) { return value; }
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

export function formatDateShort(value?: string | null): string {
  if (!value) { return ""; }
  try {
    const d = new Date(value.endsWith("Z") || value.includes("+") ? value : `${value}Z`);
    if (isNaN(d.getTime())) { return value; }
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return value;
  }
}
