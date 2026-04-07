"use client";

import { useEffect, useRef } from "react";

type FaviconBadgeProps = {
  count: number;
  color?: string;
};

export function useFaviconBadge(count: number, color = "#e53935") {
  const originalFavicon = useRef<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    // Find or create canvas
    if (!canvasRef.current) {
      canvasRef.current = document.createElement("canvas");
      canvasRef.current.width = 32;
      canvasRef.current.height = 32;
    }

    // Store original favicon
    if (originalFavicon.current === null) {
      const link = document.querySelector<HTMLLinkElement>("link[rel*='icon']");
      originalFavicon.current = link?.href ?? "/favicon.ico";
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Load original favicon
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = originalFavicon.current;

    img.onload = () => {
      ctx.clearRect(0, 0, 32, 32);
      ctx.drawImage(img, 0, 0, 32, 32);

      if (count > 0) {
        // Draw badge background
        const badgeSize = count > 9 ? 18 : 14;
        ctx.beginPath();
        ctx.arc(32 - badgeSize / 2, badgeSize / 2, badgeSize / 2 + 2, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();

        // Draw badge text
        ctx.font = `bold ${count > 9 ? 9 : 10}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "white";
        const text = count > 99 ? "99+" : String(count);
        ctx.fillText(text, 32 - badgeSize / 2, badgeSize / 2 + 1);
      }

      // Update favicon
      const link = document.querySelector<HTMLLinkElement>("link[rel*='icon']") ?? document.createElement("link");
      link.type = "image/x-icon";
      link.rel = "icon";
      link.href = canvas.toDataURL("image/png");
      document.head.appendChild(link);
    };

    img.onerror = () => {
      // If original favicon fails, just draw the badge
      if (count > 0) {
        ctx.clearRect(0, 0, 32, 32);
        ctx.fillStyle = "#e0e0e0";
        ctx.fillRect(0, 0, 32, 32);

        const badgeSize = count > 9 ? 18 : 14;
        ctx.beginPath();
        ctx.arc(32 - badgeSize / 2, badgeSize / 2, badgeSize / 2 + 2, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();

        ctx.font = `bold ${count > 9 ? 9 : 10}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "white";
        const text = count > 99 ? "99+" : String(count);
        ctx.fillText(text, 32 - badgeSize / 2, badgeSize / 2 + 1);

        const link = document.querySelector<HTMLLinkElement>("link[rel*='icon']") ?? document.createElement("link");
        link.type = "image/x-icon";
        link.rel = "icon";
        link.href = canvas.toDataURL("image/png");
        document.head.appendChild(link);
      }
    };

    // Cleanup: restore original favicon when count becomes 0
    return () => {
      if (count === 0 && originalFavicon.current) {
        const link = document.querySelector<HTMLLinkElement>("link[rel*='icon']");
        if (link) {
          link.href = originalFavicon.current;
        }
      }
    };
  }, [count, color]);
}

export function FaviconBadge({ count, color }: FaviconBadgeProps) {
  useFaviconBadge(count, color);
  return null;
}
