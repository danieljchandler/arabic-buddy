export type JingleAudioFile = {
  blob: Blob;
  mimeType: string;
  extension: "mp3" | "wav" | "ogg" | "webm" | "m4a";
};

const DEFAULT_LYRIA_SAMPLE_RATE = 48000;

const textAt = (bytes: Uint8Array, offset: number, length: number) =>
  String.fromCharCode(...bytes.slice(offset, offset + length));

const id3PayloadSize = (bytes: Uint8Array) => {
  if (bytes.length < 10 || textAt(bytes, 0, 3) !== "ID3") return 0;
  return (
    ((bytes[6] & 0x7f) << 21) |
    ((bytes[7] & 0x7f) << 14) |
    ((bytes[8] & 0x7f) << 7) |
    (bytes[9] & 0x7f)
  );
};

const id3TotalSize = (bytes: Uint8Array) => {
  const payloadSize = id3PayloadSize(bytes);
  return payloadSize ? Math.min(bytes.length, 10 + payloadSize) : 0;
};

const hasMpegFrameSync = (bytes: Uint8Array, offset = 0) => {
  for (let i = offset; i < bytes.length - 1; i++) {
    if (bytes[i] === 0xff && (bytes[i + 1] & 0xe0) === 0xe0) return true;
  }
  return false;
};

const wrapPcmAsWav = (bytes: Uint8Array, sampleRate = DEFAULT_LYRIA_SAMPLE_RATE) => {
  const dataSize = bytes.length - (bytes.length % 2);
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(bytes.slice(0, dataSize));
  return new Uint8Array(buffer);
};

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
  if (bytes.length >= 3 && textAt(bytes, 0, 3) === "ID3" && hasMpegFrameSync(bytes, id3TotalSize(bytes))) return "audio/mpeg";
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
  } else if (typeof data === "string") {
    const bytes = Uint8Array.from(data, (char) => char.charCodeAt(0) & 0xff);
    buffer = bytes.buffer;
  } else {
    throw new Error("Generated jingle returned an unreadable audio format");
  }

  const bytes = new Uint8Array(buffer);
  const id3Size = id3TotalSize(bytes);
  if (id3Size > 0 && !hasMpegFrameSync(bytes, id3Size)) {
    const wavBytes = wrapPcmAsWav(bytes.slice(id3Size));
    return {
      blob: new Blob([wavBytes], { type: "audio/wav" }),
      mimeType: "audio/wav",
      extension: "wav",
    };
  }

  const mimeType = detectAudioMime(bytes, declaredType);
  return {
    blob: new Blob([bytes], { type: mimeType }),
    mimeType,
    extension: extensionForMime(mimeType),
  };
}