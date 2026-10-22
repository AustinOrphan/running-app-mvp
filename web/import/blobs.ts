/** Reads a slice of a file as bytes; `FileReader` covers browsers and test DOMs without `arrayBuffer`. */
export async function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer())
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'))
    reader.readAsArrayBuffer(blob)
  })
}

/** Bytes read from a file in one go while walking a ZIP; small enough to keep memory flat. */
export const READ_CHUNK_BYTES = 4 * 1024 * 1024

export type ByteSource = Blob | Uint8Array

export function sourceSize(source: ByteSource): number {
  return source instanceof Uint8Array ? source.length : source.size
}

export async function readSourceChunk(
  source: ByteSource,
  start: number,
  end: number,
): Promise<Uint8Array> {
  return source instanceof Uint8Array
    ? source.subarray(start, end)
    : readBlobBytes(source.slice(start, end))
}
