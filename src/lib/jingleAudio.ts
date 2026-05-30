export type JingleAudioFile = {
  blob: Blob;
  mimeType: string;
  extension: "mp3" | "wav" | "ogg" | "webm" | "m4a";
};

const textAt = (bytes: Uint8Array, offset: number, length: number) =>
  String.fromCharCode(...bytes.slice(offset, offset + length));

const extensionForMime = (mimeType: string): JingleAudioFile["extension"] => {
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "m4a";
  return "wav";
};

const detectAudioMime = (bytes: Uint8Array, declaredType = "") => {
  if (bytes.length >= 12 && textAt(bytes, 0, 4) === "RIFF" && textAt(bytes, 8, 4) === "WAVE") {
    return "audio/wav";
  }
  if (bytes.length >= 3 && textAt(bytes, 0, 3) === "ID3") return "audio/mpeg";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return "audio/mpeg";
  if (bytes.length >= 4 && textAt(bytes, 0, 4) === "OggS") return "audio/ogg";
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "audio/webm";
  if (bytes.length >= 12 && textAt(bytes, 4, 4) === "ftyp") return "audio/mp4";

  const cleanType = declaredType.split(";")[0].toLowerCase();
  if (cleanType.startsWith("audio/") && !/l16|pcm/.test(cleanType)) return cleanType;
  return "audio/wav";
};

export async function createPlayableJingleAudio(data: unknown): Promise<JingleAudioFile> {
  const declaredType = data instanceof Blob ? data.type : "";
  let buffer: ArrayBuffer;

  if (data instanceof Blob) {
    buffer = await data.arrayBuffer();
  } else if (data instanceof ArrayBuffer) {
    buffer = data;
  } else if (ArrayBuffer.isView(data)) {
    buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  } else {
    throw new Error("Generated jingle returned an unreadable audio format");
  }

  const bytes = new Uint8Array(buffer);
  const mimeType = detectAudioMime(bytes, declaredType);
  return {
    blob: new Blob([bytes], { type: mimeType }),
    mimeType,
    extension: extensionForMime(mimeType),
  };
}