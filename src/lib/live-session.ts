// Browser-side Live API session manager.
//
// Connects the visitor's mic to Gemini Live via an ephemeral token
// minted by `/api/live-token`, plays the model's audio response back,
// and writes the input/output transcripts into `chat-store` so they
// appear alongside text turns in the unified timeline.
//
// Runs only in the browser. Lazy-loaded from the mic button so the
// SDK and the worklet don't ship for visitors who never press it.

import {
  GoogleGenAI,
  Modality,
  type Session,
  type LiveServerMessage,
} from "@google/genai";
import { appendUserVoice, appendAssistantVoice } from "./chat-store";

export type LiveState = "idle" | "requesting" | "live" | "error";

export type LiveSession = {
  readonly state: LiveState;
  readonly level: number; // combined input/output level, 0..1
  readonly errorMessage: string | null;
  /** True while the assistant is producing audio for the current turn. */
  readonly assistantSpeaking: boolean;
  /**
   * Live frequency-domain data for visualizers. 64 bins, values 0..255.
   * Combines mic input and playback output (max per bin) so the orb
   * reacts whether the visitor is talking or the assistant is.
   * Returns null when the session isn't live.
   */
  readonly frequencyData: Uint8Array | null;
  start(): Promise<void>;
  stop(): Promise<void>;
  subscribe(fn: () => void): () => void;
};

const TOKEN_URL = "/api/live-token";
const PLAYBACK_SAMPLE_RATE = 24000; // Gemini Live emits 24 kHz audio
const MIC_SAMPLE_RATE = 16000;

type TokenResponse = {
  token: string;
  expiresAt: string;
  model: string;
};

export function createLiveSession(): LiveSession {
  const listeners = new Set<() => void>();

  // Mutable state — exposed through closures + the returned object's
  // getters so subscribers always see the latest values.
  let state: LiveState = "idle";
  let level = 0;
  let errorMessage: string | null = null;
  let assistantSpeakingNow = false;

  // Resources allocated on start, torn down on stop.
  let micStream: MediaStream | null = null;
  let inputCtx: AudioContext | null = null;
  let workletNode: AudioWorkletNode | null = null;
  let outputCtx: AudioContext | null = null;
  let session: Session | null = null;
  // AnalyserNodes for the visualizer. We tap the mic stream and the
  // playback chain in parallel and combine their frequency data so the
  // orb dances whether the visitor or the assistant is making noise.
  let inputAnalyser: AnalyserNode | null = null;
  let outputAnalyser: AnalyserNode | null = null;
  let combinedFreqData: Uint8Array | null = null;
  let analyserRaf = 0;
  // The Live API requires a `setupComplete` server message before any
  // realtime input can land. Sending audio frames before that arrives
  // makes the server quietly close the WebSocket — which surfaces in
  // the browser as "WebSocket is already in CLOSING or CLOSED state".
  // We gate sends on this flag and queue early frames in pendingPcm.
  let setupReady = false;
  let pendingPcm: ArrayBuffer[] = [];
  let playbackTime = 0; // monotonically advancing for queued buffers
  // Accumulated text per active turn — Live emits transcripts in chunks
  // and we batch them into one bubble per side at turnComplete.
  let userTurnText = "";
  let assistantTurnText = "";

  const setState = (next: LiveState, err: string | null = null) => {
    state = next;
    errorMessage = err;
    notify();
  };
  const setLevel = (next: number) => {
    if (Math.abs(next - level) < 0.02 && state === "live") return;
    level = next;
    notify();
  };
  const notify = () => {
    listeners.forEach((fn) => fn());
  };

  async function fetchToken(): Promise<TokenResponse> {
    const res = await fetch(TOKEN_URL, { method: "GET" });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Token mint failed (${res.status})`);
    }
    return (await res.json()) as TokenResponse;
  }

  async function setupMic(): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone API not available in this browser.");
    }
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  }

  async function buildAudioGraph(stream: MediaStream): Promise<void> {
    inputCtx = new AudioContext({ sampleRate: MIC_SAMPLE_RATE });
    await inputCtx.audioWorklet.addModule("/audio-pcm-worklet.js");
    const source = inputCtx.createMediaStreamSource(stream);

    // Tap the mic into an AnalyserNode in parallel with the worklet so
    // the visualizer gets real frequency data (not just per-frame peak).
    inputAnalyser = inputCtx.createAnalyser();
    inputAnalyser.fftSize = 128; // 64 bins
    inputAnalyser.smoothingTimeConstant = 0.6;
    source.connect(inputAnalyser);

    workletNode = new AudioWorkletNode(inputCtx, "pcm16-downsample");
    workletNode.port.onmessage = (e: MessageEvent) => {
      const data = e.data as { kind: string; buffer: ArrayBuffer; level: number };
      if (data.kind !== "pcm") return;
      setLevel(data.level);

      // Buffer until the server says "setupComplete". Once flushed, we
      // send straight through.
      if (!session || !setupReady) {
        // Cap the buffer so an unhealthy session doesn't grow forever.
        if (pendingPcm.length < 32) pendingPcm.push(data.buffer);
        return;
      }
      sendPcmFrame(data.buffer);
    };
    source.connect(workletNode);
    // Worklet must connect to destination to actually run. Route through
    // a 0-gain node so the mic isn't audibly looped back.
    const muted = inputCtx.createGain();
    muted.gain.value = 0;
    workletNode.connect(muted);
    muted.connect(inputCtx.destination);
  }

  async function buildPlaybackContext(): Promise<void> {
    outputCtx = new AudioContext({ sampleRate: PLAYBACK_SAMPLE_RATE });
    playbackTime = outputCtx.currentTime;
    // Insert an AnalyserNode between every queued playback node and the
    // destination so the visualizer can read the assistant's audio
    // energy in real time.
    outputAnalyser = outputCtx.createAnalyser();
    outputAnalyser.fftSize = 128;
    outputAnalyser.smoothingTimeConstant = 0.6;
    outputAnalyser.connect(outputCtx.destination);
  }

  function enqueuePlayback(pcm16Base64: string) {
    if (!outputCtx || !outputAnalyser) return;
    const bytes = base64ToUint8Array(pcm16Base64);
    // Convert PCM16 LE → Float32 in [-1, 1].
    const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 0x8000;
    }
    const audioBuffer = outputCtx.createBuffer(1, float32.length, PLAYBACK_SAMPLE_RATE);
    audioBuffer.getChannelData(0).set(float32);
    const node = outputCtx.createBufferSource();
    node.buffer = audioBuffer;
    // Route through the analyser so frequency data is live during
    // assistant turns. The analyser is already wired to destination.
    node.connect(outputAnalyser);
    const startAt = Math.max(playbackTime, outputCtx.currentTime);
    node.start(startAt);
    playbackTime = startAt + audioBuffer.duration;
  }

  function flushPlayback() {
    if (outputCtx) {
      // Reset the queue cursor; existing scheduled nodes finish naturally.
      playbackTime = outputCtx.currentTime;
    }
  }

  function sendPcmFrame(buffer: ArrayBuffer) {
    if (!session) return;
    const b64 = arrayBufferToBase64(buffer);
    try {
      session.sendRealtimeInput({
        media: { data: b64, mimeType: `audio/pcm;rate=${MIC_SAMPLE_RATE}` },
      });
    } catch (err) {
      // The most common cause is a closed WebSocket. Surface it on the
      // session state so the UI can show a real error instead of going
      // silent.
      console.warn("[live] sendRealtimeInput failed", err);
      setState("error", (err as Error)?.message ?? "Send failed.");
    }
  }

  function flushPendingPcm() {
    if (!session || !setupReady || pendingPcm.length === 0) return;
    const queue = pendingPcm;
    pendingPcm = [];
    for (const buf of queue) sendPcmFrame(buf);
  }

  /**
   * Continuous frequency-domain sampling for the visualizer. Runs while
   * the session is live; merges mic + playback frequency bins (max per
   * bin) so the orb dances no matter who's making noise.
   */
  function startAnalyserLoop() {
    if (!inputAnalyser || !outputAnalyser) return;
    const inputData = new Uint8Array(inputAnalyser.frequencyBinCount);
    const outputData = new Uint8Array(outputAnalyser.frequencyBinCount);
    combinedFreqData = new Uint8Array(inputAnalyser.frequencyBinCount);

    const tick = () => {
      if (!inputAnalyser || !outputAnalyser || !combinedFreqData) {
        analyserRaf = 0;
        return;
      }
      inputAnalyser.getByteFrequencyData(inputData);
      outputAnalyser.getByteFrequencyData(outputData);

      // Combined per-bin = max(input, output). Also compute an overall
      // RMS-ish level the orb's halo + scale can read.
      let sum = 0;
      for (let i = 0; i < combinedFreqData.length; i++) {
        const v = Math.max(inputData[i], outputData[i]);
        combinedFreqData[i] = v;
        sum += v;
      }
      const avg = sum / (combinedFreqData.length * 255);
      // Boost — voice content tends to live in mid bins, average is low.
      const boosted = Math.min(1, avg * 2.2);
      if (Math.abs(boosted - level) > 0.01) {
        level = boosted;
        notify();
      } else {
        // Even when level barely moves, frequencyData itself changed;
        // notify so the visualizer redraws.
        notify();
      }
      analyserRaf = requestAnimationFrame(tick);
    };
    if (analyserRaf) cancelAnimationFrame(analyserRaf);
    analyserRaf = requestAnimationFrame(tick);
  }

  function stopAnalyserLoop() {
    if (analyserRaf) {
      cancelAnimationFrame(analyserRaf);
      analyserRaf = 0;
    }
    combinedFreqData = null;
  }

  function handleServerMessage(message: LiveServerMessage) {
    if (message.setupComplete) {
      // Server is ready — release any audio captured before this arrived.
      setupReady = true;
      flushPendingPcm();
    }

    const sc = message.serverContent;
    if (!sc) return;

    // Transcripts arrive as a stream of partial chunks. We DON'T write
    // them to chat-store as they stream — that caused the bubbles to
    // visibly dance / shuffle as text mutated character-by-character on
    // /ask. Instead, accumulate per turn locally, then commit a single
    // clean bubble per side once turnComplete arrives.
    if (sc.inputTranscription?.text) {
      userTurnText += sc.inputTranscription.text;
    }
    if (sc.outputTranscription?.text) {
      assistantTurnText += sc.outputTranscription.text;
    }

    // Audio frames from the model — queue for playback. Track that the
    // assistant is producing audio (drives the orb's "speaking" visual).
    const parts = sc.modelTurn?.parts ?? [];
    let producedAudio = false;
    for (const part of parts) {
      const inline = (part as any).inlineData;
      if (inline?.data && inline?.mimeType?.startsWith("audio/")) {
        enqueuePlayback(inline.data);
        producedAudio = true;
      }
    }
    // Stash a transient "assistant is talking" flag on a synthetic msg id
    // so the orb can pulse a different shade. We attach it to the live
    // session itself rather than chat-store to keep state out of UI
    // bubbles entirely.
    if (producedAudio) {
      assistantSpeakingNow = true;
      notify();
    }

    if (sc.interrupted) {
      flushPlayback();
      assistantSpeakingNow = false;
      notify();
    }

    if (sc.turnComplete) {
      // Commit the accumulated text to chat-store as a single, clean
      // pair of bubbles. No partial patches — bubbles only appear once
      // they're complete.
      const u = userTurnText.trim();
      const a = assistantTurnText.trim();
      if (u) appendUserVoice(u);
      if (a) appendAssistantVoice(a);
      userTurnText = "";
      assistantTurnText = "";
      assistantSpeakingNow = false;
      notify();
    }
  }

  async function start() {
    if (state === "live" || state === "requesting") return;
    setupReady = false;
    pendingPcm = [];
    setState("requesting");
    try {
      const tokenResp = await fetchToken();
      micStream = await setupMic();
      await buildPlaybackContext();
      await buildAudioGraph(micStream);

      const client = new GoogleGenAI({
        apiKey: tokenResp.token,
        // Ephemeral tokens require v1alpha at the moment.
        apiVersion: "v1alpha",
      } as any);

      session = await client.live.connect({
        model: tokenResp.model,
        callbacks: {
          onopen: () => {
            setState("live");
            startAnalyserLoop();
          },
          onmessage: handleServerMessage,
          onerror: (e: ErrorEvent) => {
            console.error("[live] socket error", e);
            setState("error", e.message ?? "Live connection error.");
          },
          onclose: (e: CloseEvent) => {
            // 1000 = normal close. Anything else is interesting and worth
            // surfacing — many setup-rejection cases land here without
            // hitting onerror first.
            if (e.code !== 1000) {
              console.warn(
                `[live] socket closed code=${e.code} reason=${e.reason || "(none)"}`,
              );
            }
            if (state === "live" && e.code !== 1000) {
              setState(
                "error",
                e.reason || `Connection dropped (code ${e.code}).`,
              );
            } else if (state === "live") {
              setState("idle");
            }
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to start voice mode.";
      setState("error", msg);
      await stop();
    }
  }

  async function stop() {
    stopAnalyserLoop();
    try {
      session?.close();
    } catch {}
    session = null;
    if (workletNode) {
      try {
        workletNode.disconnect();
      } catch {}
      workletNode = null;
    }
    if (inputAnalyser) {
      try {
        inputAnalyser.disconnect();
      } catch {}
      inputAnalyser = null;
    }
    if (outputAnalyser) {
      try {
        outputAnalyser.disconnect();
      } catch {}
      outputAnalyser = null;
    }
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
    }
    if (inputCtx) {
      try {
        await inputCtx.close();
      } catch {}
      inputCtx = null;
    }
    if (outputCtx) {
      try {
        await outputCtx.close();
      } catch {}
      outputCtx = null;
    }
    // Commit any in-flight turn text so the visitor sees what was said
    // before disconnect, then reset.
    const u = userTurnText.trim();
    const a = assistantTurnText.trim();
    if (u) appendUserVoice(u);
    if (a) appendAssistantVoice(a);
    userTurnText = "";
    assistantTurnText = "";
    assistantSpeakingNow = false;
    setupReady = false;
    pendingPcm = [];
    setLevel(0);
    if (state !== "error") setState("idle");
  }

  return {
    get state() {
      return state;
    },
    get level() {
      return level;
    },
    get errorMessage() {
      return errorMessage;
    },
    get assistantSpeaking() {
      return assistantSpeakingNow;
    },
    get frequencyData() {
      return combinedFreqData;
    },
    start,
    stop,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

// ────────────────────────────────────────────────────────────────────────
// Helpers

function arrayBufferToBase64(buf: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buf);
  // 0x8000 chunks keep us under the argument limit on String.fromCharCode.
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
