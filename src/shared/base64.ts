export function fromBase64(base64: string): string {
  return Buffer.from(base64, 'base64').toString('utf-8')
}

export function toBase64(string: string): string {
  return Buffer.from(string).toString('base64')
}
