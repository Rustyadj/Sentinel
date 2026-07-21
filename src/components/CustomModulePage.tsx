"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Puzzle } from "lucide-react";

interface CustomModuleData {
  moduleId: string;
  label: string;
  icon: string;
  description: string | null;
  contentType: string;
  content: string;
}

export function CustomModulePage({ mod }: { mod: CustomModuleData }) {
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/15 flex items-center justify-center">
            <Puzzle className="w-5 h-5 text-purple-500" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[#1a1d26]">{mod.label}</h1>
            {mod.description && <p className="text-xs text-[#7a8099]">{mod.description}</p>}
          </div>
        </div>
        {mod.contentType === "markdown" && (
          <div className="prose prose-sm max-w-none text-[#3a4060]">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{mod.content}</ReactMarkdown>
          </div>
        )}
        {mod.contentType === "iframe" && (
          <iframe src={mod.content} className="w-full h-[600px] rounded-xl border border-[#e0e3ea]" />
        )}
      </div>
    </div>
  );
}
