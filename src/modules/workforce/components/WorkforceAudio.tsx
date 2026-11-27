"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function WorkforceAudio({ workspaceId, available }: { workspaceId: string; available: boolean }) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const [recording, setRecording] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => () => { if (recording) URL.revokeObjectURL(recording); }, [recording]);

  async function process(action: "transcribe" | "synthesize", body: string | File) {
    setStatus("");
    setBusy(true);
    try {
      const response = await fetch(`/api/workforce/media?workspaceId=${encodeURIComponent(workspaceId)}&action=${action}`, { method: "POST", body });
      if (!response.ok) {
        const { error } = await response.json();
        throw new Error(error ?? "Could not process audio.");
      }
      if (action === "transcribe") {
        const result = await response.json();
        setText(result.text);
        setStatus("Transcription ready.");
      } else {
        setRecording(URL.createObjectURL(await response.blob()));
        setStatus("Generated speech is ready.");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not process audio.");
    } finally {
      setBusy(false);
    }
  }

  return <Card>
    <CardHeader><CardTitle>Audio tools</CardTitle></CardHeader>
    <CardContent className="space-y-3 text-sm">
      {!available ? <p>Connect OpenAI to transcribe recordings and generate speech in this workspace.</p> : <>
        <label className="grid gap-1">Transcribe a recording (up to 10 MB)
          <input type="file" accept=".mp3,.mp4,.m4a,.wav,.webm,.flac,.ogg,audio/*" disabled={busy} onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void process("transcribe", file);
          }} />
        </label>
        <label className="grid gap-1">Transcript or script
          <textarea className="min-h-32 rounded-md border border-(--border) bg-(--background) p-2" value={text} disabled={busy} onChange={(event) => setText(event.target.value)} />
        </label>
        <Button type="button" size="sm" disabled={busy || !text.trim() || text.trim().length > 4096} onClick={() => void process("synthesize", text)}>Generate speech</Button>
        {text.length > 4096 && <p>Select up to 4,096 characters to generate speech.</p>}
        {recording && <div className="space-y-2">
          <p>AI-generated speech</p>
          <audio controls src={recording} className="max-w-full" />
          <a className="block w-fit underline" href={recording} download="sentinel-speech.mp3">Download MP3</a>
        </div>}
      </>}
      {status && <p role="status">{status}</p>}
    </CardContent>
  </Card>;
}
