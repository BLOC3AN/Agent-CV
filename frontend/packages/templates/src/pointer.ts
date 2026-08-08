/**
 * JSON Pointer helper — RFC 6901.
 *
 * Để RIÊNG khỏi field.tsx: file đó mang "use client" (cần React Context), nên
 * MỌI export của nó bị Next coi là client reference. `ptr` là hàm thuần được
 * GỌI trong lúc server-render sections → phải nằm ở module server-safe.
 */
export function ptr(...parts: (string | number)[]): string {
  return (
    '/' +
    parts.map((p) => String(p).replace(/~/g, '~0').replace(/\//g, '~1')).join('/')
  )
}
