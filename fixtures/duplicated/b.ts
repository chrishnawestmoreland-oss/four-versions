// Same helper again, different variable names — copy 2 of 3.
export function formatDateString(value: string): string {
  const parsed = new Date(value);
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const date = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${date}`;
}

// Same name as in a.ts, but a different body — a name collision.
export function slugify(title: string): string {
  return title.toUpperCase().replace(/\s+/g, "_");
}
