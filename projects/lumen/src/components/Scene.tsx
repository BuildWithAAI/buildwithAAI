"use client";

import { useEffect, useRef } from "react";

type Props = {
  color: string;
  pulseMs: number;
  amplitude: number;
  eventKind: string | null;
  asleep: boolean;
  mood: number;
};

export function Scene({ color, pulseMs, amplitude, eventKind, asleep, mood }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let frame = 0;
    let stop = false;
    const draw = () => {
      if (stop) return;
      frame += 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const g = ctx.createLinearGradient(0, 0, 0, height);
      g.addColorStop(0, "#0d3a44");
      g.addColorStop(1, "#041014");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#10262b";
      ctx.beginPath();
      ctx.ellipse(width * 0.5, height * 0.92, width * 0.48, 36, 0, 0, Math.PI * 2);
      ctx.fill();
      const pulse = asleep ? 0.15 : (Math.sin((frame / Math.max(pulseMs, 400)) * 16) * 0.5 + 0.5) * amplitude;
      const cx = width * 0.5;
      const cy = height * 0.42 + Math.sin(frame / 40) * 8;
      const bell = 70 + pulse * 26 + mood * 8;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.22 + pulse * 0.35;
      ctx.beginPath();
      ctx.ellipse(cx, cy, bell, bell * 0.72, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, bell * 0.72, bell * 0.48, 0, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 7; i += 1) {
        const x = cx - 48 + i * 16;
        ctx.beginPath();
        ctx.moveTo(x, cy + bell * 0.35);
        for (let y = 0; y < 120; y += 8) {
          const sway = Math.sin(frame / 18 + i + y / 30) * (8 + pulse * 10);
          ctx.lineTo(x + sway, cy + bell * 0.35 + y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 0.8;
      for (let i = 0; i < 18; i += 1) {
        const px = (i * 97 + frame) % width;
        const py = (i * 53 + frame * 0.4) % height;
        ctx.beginPath();
        ctx.arc(px, py, eventKind === "plankton-bloom" ? 3 : 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
      if (eventKind === "storm" || eventKind === "calm-rain") {
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = "#d5fff6";
        for (let i = 0; i < 20; i += 1) {
          const x = (i * 60 + frame * 3) % width;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x - 12, height);
          ctx.stroke();
        }
      }
      if (eventKind === "fish-school") {
        ctx.globalAlpha = 0.8;
        for (let i = 0; i < 6; i += 1) {
          const x = (frame * 1.4 + i * 28) % (width + 40) - 20;
          ctx.beginPath();
          ctx.ellipse(x, height * 0.3 + i * 8, 8, 3, 0.2, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      requestAnimationFrame(draw);
    };
    draw();
    return () => {
      stop = true;
    };
  }, [amplitude, asleep, color, eventKind, mood, pulseMs]);

  return <canvas ref={ref} className="bowl" aria-label="Zoora in the Glass Bowl" />;
}
