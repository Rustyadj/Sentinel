"use client";

import { useState } from "react";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import {
  Layout,
  Type,
  Square,
  Image,
  ToggleLeft,
  Table2,
  ChevronRight,
  Eye,
  Code2,
  Play,
  Send,
  Sparkles,
  Monitor,
  Smartphone,
  Tablet,
} from "lucide-react";

const COMPONENTS = [
  { group: "Layout",  items: ["Container", "Grid", "Flex Row", "Section", "Divider"] },
  { group: "Content", items: ["Heading", "Paragraph", "Badge", "Avatar", "Icon"] },
  { group: "Input",   items: ["Button", "Input Field", "Dropdown", "Toggle", "Checkbox"] },
  { group: "Data",    items: ["Table", "Chart", "Card", "List", "Timeline"] },
];

const CANVAS_ELEMENTS = [
  { id: "h1",  type: "Heading",  label: "Welcome to your app",  x: 48,  y: 40,  w: 320, h: 40 },
  { id: "p1",  type: "Text",     label: "Build something great with AI", x: 48, y: 92, w: 280, h: 24 },
  { id: "btn", type: "Button",   label: "Get Started",           x: 48,  y: 132, w: 120, h: 36 },
  { id: "c1",  type: "Card",     label: "Feature block",         x: 48,  y: 200, w: 300, h: 100 },
];

export default function StudioPage() {
  const [activeViewport, setActiveViewport] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [prompt, setPrompt] = useState("");
  const [selectedEl, setSelectedEl] = useState<string | null>("btn");

  const selectedElement = CANVAS_ELEMENTS.find(e => e.id === selectedEl);

  return (
    <WorkspaceShell noPadding className="flex flex-col h-full">
      {/* Studio Toolbar */}
      <div className="h-11 border-b border-[--canvas-card-border] bg-[--canvas] flex items-center px-4 gap-3 shrink-0">
        <span className="text-sm font-semibold text-[--canvas-foreground]">Studio</span>
        <span className="text-[--canvas-muted] text-xs">· Untitled App</span>
        <div className="flex-1" />
        {/* Viewport switcher */}
        <div className="flex items-center gap-0.5 bg-[--canvas-card] rounded-lg border border-[--canvas-card-border] p-0.5">
          {(["desktop", "tablet", "mobile"] as const).map((v) => {
            const Icon = v === "desktop" ? Monitor : v === "tablet" ? Tablet : Smartphone;
            return (
              <button
                key={v}
                onClick={() => setActiveViewport(v)}
                className={`p-1.5 rounded-md transition-colors ${
                  activeViewport === v
                    ? "bg-[--primary]/20 text-[--primary]"
                    : "text-[--muted-foreground] hover:text-[--foreground]"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1">
          <button className="flex items-center gap-1.5 h-7 px-3 rounded-md text-xs text-[--canvas-muted] hover:text-[--canvas-foreground] hover:bg-[--canvas-card] transition-colors border border-transparent hover:border-[--canvas-card-border]">
            <Eye className="w-3.5 h-3.5" /> Preview
          </button>
          <button className="flex items-center gap-1.5 h-7 px-3 rounded-md text-xs text-[--canvas-muted] hover:text-[--canvas-foreground] hover:bg-[--canvas-card] transition-colors border border-transparent hover:border-[--canvas-card-border]">
            <Code2 className="w-3.5 h-3.5" /> Code
          </button>
          <button className="flex items-center gap-1.5 h-7 px-3 rounded-md text-xs font-medium bg-[--primary] text-white hover:bg-[--primary]/90 transition-colors">
            <Play className="w-3 h-3" /> Deploy
          </button>
        </div>
      </div>

      {/* Three-panel layout */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: Component panel */}
        <div className="w-52 shrink-0 border-r border-[--canvas-card-border] bg-[--canvas] overflow-y-auto">
          <div className="p-3">
            <div className="text-[10px] font-semibold text-[--canvas-muted] uppercase tracking-wider mb-3">
              Components
            </div>
            {COMPONENTS.map((group) => (
              <div key={group.group} className="mb-4">
                <div className="text-[10px] text-[--canvas-muted] mb-1.5 px-1">
                  {group.group}
                </div>
                {group.items.map((item) => (
                  <button
                    key={item}
                    draggable
                    className="w-full flex items-center gap-2 h-7 px-2 rounded text-xs text-[--canvas-foreground] hover:bg-[--canvas-card] hover:border hover:border-[--canvas-card-border] transition-all text-left"
                  >
                    <span className="w-3.5 h-3.5 rounded bg-[--canvas-card] border border-[--canvas-card-border] shrink-0" />
                    {item}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Center: Canvas */}
        <div className="flex-1 min-w-0 overflow-auto bg-[#e8eaed] flex items-start justify-center p-8">
          <div
            className={`bg-white rounded-xl shadow-lg border border-gray-200 relative overflow-hidden transition-all duration-200 ${
              activeViewport === "desktop"
                ? "w-full max-w-2xl min-h-96"
                : activeViewport === "tablet"
                ? "w-[768px] min-h-96"
                : "w-[375px] min-h-96"
            }`}
            style={{ minHeight: "480px" }}
          >
            {/* Canvas grid dots */}
            <div
              className="absolute inset-0 opacity-30"
              style={{
                backgroundImage: "radial-gradient(circle, #cbd5e1 1px, transparent 1px)",
                backgroundSize: "20px 20px",
              }}
            />
            {/* Mock elements */}
            {CANVAS_ELEMENTS.map((el) => (
              <div
                key={el.id}
                onClick={() => setSelectedEl(el.id)}
                className={`absolute cursor-pointer rounded transition-all ${
                  selectedEl === el.id
                    ? "ring-2 ring-indigo-500 ring-offset-1"
                    : "hover:ring-1 hover:ring-indigo-300"
                }`}
                style={{ left: el.x, top: el.y, width: el.w, height: el.h }}
              >
                {el.type === "Heading" && (
                  <span className="text-xl font-bold text-gray-900">{el.label}</span>
                )}
                {el.type === "Text" && (
                  <span className="text-sm text-gray-500">{el.label}</span>
                )}
                {el.type === "Button" && (
                  <button className="h-full w-full bg-indigo-600 text-white text-sm font-medium rounded-lg">
                    {el.label}
                  </button>
                )}
                {el.type === "Card" && (
                  <div className="h-full w-full rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center">
                    <span className="text-xs text-gray-400">{el.label}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right: Properties panel */}
        <div className="w-56 shrink-0 border-l border-[--canvas-card-border] bg-[--canvas] overflow-y-auto">
          <div className="p-3">
            <div className="text-[10px] font-semibold text-[--canvas-muted] uppercase tracking-wider mb-3">
              Properties
            </div>
            {selectedElement ? (
              <div className="space-y-4">
                <div>
                  <div className="text-[10px] text-[--canvas-muted] mb-1">Element</div>
                  <div className="text-xs font-medium text-[--canvas-foreground]">
                    {selectedElement.type}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-[--canvas-muted] mb-1">Label</div>
                  <input
                    className="w-full h-7 px-2 rounded-md border border-[--canvas-card-border] bg-[--canvas-card] text-xs text-[--canvas-card-foreground] focus:outline-none focus:border-[--primary]"
                    defaultValue={selectedElement.label}
                  />
                </div>
                <div>
                  <div className="text-[10px] text-[--canvas-muted] mb-2">Position</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {["X", "Y", "W", "H"].map((axis, i) => (
                      <div key={axis}>
                        <div className="text-[9px] text-[--canvas-muted] mb-0.5">{axis}</div>
                        <input
                          className="w-full h-6 px-1.5 rounded border border-[--canvas-card-border] bg-[--canvas-card] text-xs text-[--canvas-card-foreground] focus:outline-none focus:border-[--primary]"
                          defaultValue={[selectedElement.x, selectedElement.y, selectedElement.w, selectedElement.h][i]}
                        />
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-[--canvas-muted] mb-1">Style</div>
                  <div className="space-y-1.5">
                    {["Background", "Text Color", "Border Radius", "Font Size"].map((prop) => (
                      <div key={prop} className="flex items-center gap-2">
                        <span className="text-[10px] text-[--canvas-muted] w-20 shrink-0">{prop}</span>
                        <input className="flex-1 h-5 px-1.5 rounded border border-[--canvas-card-border] bg-[--canvas-card] text-[10px] text-[--canvas-card-foreground] focus:outline-none" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-[--canvas-muted] text-center py-8">
                Select an element to edit its properties
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom: AI prompt bar */}
      <div className="h-14 shrink-0 border-t border-[--canvas-card-border] bg-[--canvas] flex items-center px-4 gap-3">
        <Sparkles className="w-4 h-4 text-[--primary] shrink-0" />
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe what to build or modify… e.g. 'Add a pricing section with three tiers'"
          className="flex-1 bg-transparent text-sm text-[--canvas-foreground] placeholder:text-[--canvas-muted] focus:outline-none"
        />
        <button
          className="h-8 w-8 flex items-center justify-center rounded-lg bg-[--primary]/20 text-[--primary] hover:bg-[--primary]/30 transition-colors shrink-0"
          onClick={() => setPrompt("")}
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </div>
    </WorkspaceShell>
  );
}
