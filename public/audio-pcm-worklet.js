// AudioWorkletProcessor that converts the mic stream (whatever the
// browser's native sample rate is, typically 48000 Hz) into 16 kHz mono
// PCM16 chunks suitable for Gemini Live's `audio/pcm;rate=16000` input.
//
// Loaded via `audioContext.audioWorklet.addModule('/audio-pcm-worklet.js')`
// from src/lib/live-session.ts. Posts batched ArrayBuffers (PCM16 LE)
// back to the main thread roughly every 250ms so the SDK can frame them
// over the WebSocket.

const TARGET_SAMPLE_RATE = 16000;
const FRAME_MS = 250;
const FRAME_SAMPLES = (TARGET_SAMPLE_RATE * FRAME_MS) / 1000; // 4000

class PCM16DownsampleProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Ratio between input rate and 16 kHz. We re-derive each callback
    // (sampleRate is constant once the context is created, but reading
    // it lets the worklet stay correct if the host ever changes).
    this.ratio = sampleRate / TARGET_SAMPLE_RATE;
    // Position-in-fractional-samples cursor that advances by `ratio`
    // each output sample so we sample the input at the correct rate.
    this.cursor = 0;
    // Batch buffer for outgoing PCM16. Sized to one frame.
    this.frame = new Int16Array(FRAME_SAMPLES);
    this.frameOffset = 0;
    // Lightweight peak tracker so the main thread can drive a level meter.
    this.levelPeak = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0]; // mono — discard any extra channels
    if (!channel || channel.length === 0) return true;

    // Track input level for the UI (max abs sample in this callback).
    for (let i = 0; i < channel.length; i++) {
      const v = Math.abs(channel[i]);
      if (v > this.levelPeak) this.levelPeak = v;
    }

    // Linear-interpolation downsample. Float32 in [-1, 1] → Int16.
    while (this.cursor < channel.length) {
      const idx = this.cursor | 0;
      const frac = this.cursor - idx;
      const a = channel[idx] ?? 0;
      const b = channel[idx + 1] ?? a;
      const sample = a + (b - a) * frac;
      const clamped = Math.max(-1, Math.min(1, sample));
      this.frame[this.frameOffset++] = clamped < 0
        ? clamped * 0x8000
        : clamped * 0x7fff;

      if (this.frameOffset >= FRAME_SAMPLES) {
        // Transfer the buffer (zero-copy) and report current peak.
        const out = this.frame.buffer.slice(0);
        this.port.postMessage(
          { kind: "pcm", buffer: out, level: this.levelPeak },
          [out],
        );
        this.frame = new Int16Array(FRAME_SAMPLES);
        this.frameOffset = 0;
        this.levelPeak = 0;
      }
      this.cursor += this.ratio;
    }
    // Carry over any leftover fractional position so successive blocks
    // align cleanly.
    this.cursor -= channel.length;
    return true;
  }
}

registerProcessor("pcm16-downsample", PCM16DownsampleProcessor);
