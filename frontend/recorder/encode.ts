// Kadrlarni brauzerning o'zida (WebCodecs) videoga kodlash — ffmpeg kerak emas.
// mp4 → H.264, webm → VP9. Natija — ArrayBuffer (muxer xotirada yig'adi).
import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from "mp4-muxer";
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from "webm-muxer";

export type VideoFormat = "mp4" | "webm";

export interface EncodeOptions {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  fps: number;
  frames: number;
  bitrate: number;
  format: VideoFormat;
  /** i-kadrni canvas'ga chizadi (sinxron) */
  renderFrame: (i: number) => void;
}

const CANDIDATES: Record<VideoFormat, string[]> = {
  // High 4.0 → Main 4.0 → Constrained Baseline 4.0
  mp4: ["avc1.640028", "avc1.4d0028", "avc1.42e028"],
  webm: ["vp09.00.40.08", "vp09.00.10.08"],
};

function baseConfig(codec: string, o: Pick<EncodeOptions, "width" | "height" | "fps" | "bitrate" | "format">): VideoEncoderConfig {
  return {
    codec,
    width: o.width,
    height: o.height,
    bitrate: o.bitrate,
    framerate: o.fps,
    latencyMode: "quality",
    ...(o.format === "mp4" ? { avc: { format: "avc" as const } } : {}),
  };
}

/** Brauzer qo'llab-quvvatlaydigan birinchi codec'ni tanlaydi. */
export async function pickCodec(o: Pick<EncodeOptions, "width" | "height" | "fps" | "bitrate" | "format">): Promise<string> {
  for (const codec of CANDIDATES[o.format]) {
    const r = await VideoEncoder.isConfigSupported(baseConfig(codec, o));
    if (r.supported) return codec;
  }
  throw new Error(`${o.format}: bu brauzer ${CANDIDATES[o.format].join(" / ")} kodlay olmaydi`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function encode(o: EncodeOptions): Promise<Uint8Array> {
  const codec = await pickCodec(o);

  const mp4 = o.format === "mp4" ? new Mp4Muxer({ target: new Mp4Target(), video: { codec: "avc", width: o.width, height: o.height }, fastStart: "in-memory" }) : null;
  const webm = o.format === "webm" ? new WebmMuxer({ target: new WebmTarget(), video: { codec: "V_VP9", width: o.width, height: o.height, frameRate: o.fps } }) : null;

  let failure: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => (mp4 ?? webm)!.addVideoChunk(chunk, meta),
    error: (e) => {
      failure = e;
    },
  });
  encoder.configure(baseConfig(codec, o));

  const step = 1e6 / o.fps; // mikrosoniya
  for (let i = 0; i < o.frames; i++) {
    o.renderFrame(i);
    const frame = new VideoFrame(o.canvas, { timestamp: Math.round(i * step), duration: Math.round(step) });
    encoder.encode(frame, { keyFrame: i % o.fps === 0 }); // har soniyada kalit kadr — qidirish/takrorlash uchun
    frame.close();
    while (encoder.encodeQueueSize > 6) await sleep(1);
    if (failure) throw failure;
  }
  await encoder.flush();
  if (failure) throw failure;
  encoder.close();

  if (mp4) {
    mp4.finalize();
    return new Uint8Array(mp4.target.buffer);
  }
  webm!.finalize();
  return new Uint8Array(webm!.target.buffer);
}
