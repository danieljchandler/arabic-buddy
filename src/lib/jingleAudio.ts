export type JingleAudioFile = {
  blob: Blob;
  mimeType: string;
  extension: "mp3" | "wav" | "ogg" | "webm" | "m4a";
};

type GeneratedJingleAudioResponse = {
  audioBase64: string;
  mimeType?: string;
  extension?: JingleAudioFile["extension"];
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
  const limit = Math.min(bytes.length - 4, offset + 16384);
  for (let i = offset; i < limit; i++) {
    const frameLength = mpegFrameLength(bytes, i);
    if (!frameLength) continue;
    const next = i + frameLength;
    if (next + 4 <= bytes.length && mpegFrameLength(bytes, next)) return true;
  }
  return false;
};

const isValidMpegHeader = (bytes: Uint8Array, offset: number) => {
  if (offset + 4 > bytes.length) return false;
  if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) return false;
  const version = (bytes[offset + 1] >> 3) & 0x03;
  const layer = (bytes[offset + 1] >> 1) & 0x03;
  const bitrate = (bytes[offset + 2] >> 4) & 0x0f;
  const sampleRate = (bytes[offset + 2] >> 2) & 0x03;
  const emphasis = bytes[offset + 3] & 0x03;
  return version !== 0x01 && layer !== 0x00 && bitrate !== 0x00 && bitrate !== 0x0f && sampleRate !== 0x03 && emphasis !== 0x02;
};

const mpegFrameLength = (bytes: Uint8Array, offset: number) => {
  if (!isValidMpegHeader(bytes, offset)) return 0;
  const version = (bytes[offset + 1] >> 3) & 0x03;
  const layer = (bytes[offset + 1] >> 1) & 0x03;
  const bitrateIndex = (bytes[offset + 2] >> 4) & 0x0f;
  const sampleRateIndex = (bytes[offset + 2] >> 2) & 0x03;
  const padding = (bytes[offset + 2] >> 1) & 0x01;
  const sampleRates: Record<number, number[]> = {
    0: [11025, 12000, 8000],
    2: [22050, 24000, 16000],
    3: [44100, 48000, 32000],
  };
  const v1 = version === 3;
  const bitrateTable = v1
    ? layer === 3
      ? [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448]
      : layer === 2
      ? [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384]
      : [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
    : layer === 3
    ? [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256]
    : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const bitrate = bitrateTable[bitrateIndex] * 1000;
  const sampleRate = sampleRates[version]?.[sampleRateIndex] ?? 0;
  if (!bitrate || !sampleRate) return 0;
  if (layer === 3) return Math.floor(((12 * bitrate) / sampleRate + padding) * 4);
  const coefficient = layer === 1 && !v1 ? 72 : 144;
  return Math.floor((coefficient * bitrate) / sampleRate + padding);
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
  if (bytes.length >= 3 && textAt(bytes, 0, 3) === "ID3") return "audio/mpeg";
  if (isValidMpegHeader(bytes, 0)) return "audio/mpeg";
  if (bytes.length >= 4 && textAt(bytes, 0, 4) === "OggS") return "audio/ogg";
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "audio/webm";
  if (bytes.length >= 12 && textAt(bytes, 4, 4) === "ftyp") return "audio/mp4";

  const cleanType = declaredType.split(";")[0].toLowerCase();
  if (cleanType.startsWith("audio/") && !/l16|pcm/.test(cleanType)) return cleanType;
  return "audio/wav";
};

const isGeneratedJingleAudioResponse = (data: unknown): data is GeneratedJingleAudioResponse =>
  typeof data === "object" &&
  data !== null &&
  typeof (data as GeneratedJingleAudioResponse).audioBase64 === "string";

const base64ToBytes = (base64: string) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

export async function createPlayableJingleAudio(data: unknown): Promise<JingleAudioFile> {
  if (isGeneratedJingleAudioResponse(data)) {
    const bytes = base64ToBytes(data.audioBase64);
    const mimeType = detectAudioMime(bytes, data.mimeType || "audio/mpeg");
    return {
      blob: new Blob([bytes], { type: mimeType }),
      mimeType,
      extension: data.extension || extensionForMime(mimeType),
    };
  }

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
  const mimeType = detectAudioMime(bytes, declaredType);
  return {
    blob: new Blob([bytes], { type: mimeType }),
    mimeType,
    extension: extensionForMime(mimeType),
  };
}

export async function createPlayableJingleAudioFromUrl(url: string): Promise<JingleAudioFile> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load generated jingle audio");
  return createPlayableJingleAudio(await response.blob());
}