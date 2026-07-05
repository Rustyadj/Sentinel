import type { VoiceProvider, VoiceProviderConfig, VoiceStatus } from "../types";

// Minimal Web Speech API types (not always present in TS lib depending on config)
interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface ISpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: ((this: ISpeechRecognition, ev: Event) => void) | null;
  onend: ((this: ISpeechRecognition, ev: Event) => void) | null;
  onerror: ((this: ISpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null;
  onresult: ((this: ISpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionConstructor {
  new (): ISpeechRecognition;
}

function getSpeechRecognitionAPI(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w["SpeechRecognition"] ?? w["webkitSpeechRecognition"]) as SpeechRecognitionConstructor | null ?? null;
}

export class BrowserSpeechProvider implements VoiceProvider {
  readonly name = "browser_stt";
  private status: VoiceStatus = "idle";
  private config: VoiceProviderConfig | null = null;
  private recognition: ISpeechRecognition | null = null;

  async startSession(config: VoiceProviderConfig): Promise<void> {
    const SpeechRecognitionAPI = getSpeechRecognitionAPI();

    if (!SpeechRecognitionAPI) {
      config.onError?.(new Error("SpeechRecognition is not supported in this browser"));
      return;
    }

    this.config = config;
    this.recognition = new SpeechRecognitionAPI();
    this.recognition.continuous = false;
    this.recognition.interimResults = true;
    this.recognition.lang = config.language ?? "en-US";

    this.recognition.onstart = () => this.setStatus("listening");
    this.recognition.onend = () => this.setStatus("idle");
    this.recognition.onerror = (e: SpeechRecognitionErrorEvent) => {
      this.config?.onError?.(new Error(e.error));
      this.setStatus("error");
    };
    this.recognition.onresult = (e: SpeechRecognitionEvent) => {
      const result = e.results[e.results.length - 1];
      const transcript = result[0].transcript;
      const isFinal = result.isFinal;
      this.config?.onTranscript?.({ text: transcript, isFinal, confidence: result[0].confidence });
      if (isFinal) this.setStatus("transcribing");
    };

    this.recognition.start();
  }

  async stopSession(): Promise<void> {
    this.recognition?.stop();
    this.recognition = null;
    this.config = null;
    this.setStatus("idle");
  }

  async sendAudio(_audio: Blob): Promise<void> {
    // BrowserSpeech handles audio internally via getUserMedia — not used here
  }

  async sendText(text: string): Promise<void> {
    this.config?.onTranscript?.({ text, isFinal: true });
  }

  getStatus(): VoiceStatus {
    return this.status;
  }

  private setStatus(s: VoiceStatus) {
    this.status = s;
    this.config?.onStatusChange?.(s);
  }
}
