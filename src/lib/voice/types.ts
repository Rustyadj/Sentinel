export type VoiceStatus =
  | "idle"
  | "listening"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "error";

export interface VoiceTranscript {
  text: string;
  isFinal: boolean;
  confidence?: number;
}

export interface VoiceProviderConfig {
  agentId?: string;
  language?: string;
  onTranscript?: (t: VoiceTranscript) => void;
  onAudio?: (audio: Blob) => void;
  onStatusChange?: (status: VoiceStatus) => void;
  onError?: (err: Error) => void;
}

export interface VoiceProvider {
  readonly name: string;
  startSession(config: VoiceProviderConfig): Promise<void>;
  stopSession(): Promise<void>;
  sendAudio(audio: Blob): Promise<void>;
  sendText(text: string): Promise<void>;
  getStatus(): VoiceStatus;
}
