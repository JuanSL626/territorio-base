export type ClassValue = string | false | null | undefined;

/** Une clases condicionales sin traer una dependencia para tres líneas. */
export function cn(...parts: ClassValue[]): string {
  return parts
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ');
}
