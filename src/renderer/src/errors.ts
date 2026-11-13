/** Quita el prefijo técnico que Electron añade a los errores que vienen del proceso principal. */
export function errorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  return raw.replace(/^Error invoking remote method '[^']+':\s*(?:\w*Error:\s*)?/, '')
}
