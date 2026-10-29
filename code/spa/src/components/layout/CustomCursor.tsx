import { useEffect, useState } from "react";
import { motion, useSpring } from "framer-motion";

export function CustomCursor() {
  const [isHovered, setIsHovered] = useState(false);
  const [isPointer, setIsPointer] = useState(false);
  const [isFinePointer, setIsFinePointer] = useState(() => globalThis.matchMedia("(pointer: fine)").matches);

  const springConfig = { damping: 25, stiffness: 300, mass: 0.5 };
  const cursorX = useSpring(-100, springConfig);
  const cursorY = useSpring(-100, springConfig);

  useEffect(() => {
    const mediaQueryList = globalThis.matchMedia("(pointer: fine)");

    const handleChange = (e: MediaQueryListEvent) => {
      setIsFinePointer(e.matches);
    };

    setIsFinePointer(mediaQueryList.matches);
    mediaQueryList.addEventListener("change", handleChange);

    return () => {
      mediaQueryList.removeEventListener("change", handleChange);
    };
  }, []);

  useEffect(() => {
    // Only enable on fine pointer devices (desktops)
    if (isFinePointer) {
      const moveCursor = (e: MouseEvent) => {
        cursorX.set(e.clientX - 16);
        cursorY.set(e.clientY - 16);
      };

      const handleMouseOver = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        const computedStyle = globalThis.getComputedStyle(target);
        const isInteractive = computedStyle.cursor === "pointer"
          || target.tagName.toLowerCase() === "a"
          || target.tagName.toLowerCase() === "button";
        setIsPointer(isInteractive);
      };

      const handleMouseDown = () => setIsHovered(true);
      const handleMouseUp = () => setIsHovered(false);

      globalThis.addEventListener("mousemove", moveCursor);
      globalThis.addEventListener("mouseover", handleMouseOver);
      globalThis.addEventListener("mousedown", handleMouseDown);
      globalThis.addEventListener("mouseup", handleMouseUp);

      return () => {
        globalThis.removeEventListener("mousemove", moveCursor);
        globalThis.removeEventListener("mouseover", handleMouseOver);
        globalThis.removeEventListener("mousedown", handleMouseDown);
        globalThis.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [cursorX, cursorY, isFinePointer]);

  // Hide the default cursor in global css if using custom cursor
  useEffect(() => {
    if (isFinePointer) {
      document.body.style.cursor = 'none';
      const style = document.createElement('style');
      style.id = 'custom-cursor-style';
      style.innerHTML = `
        body * { cursor: none !important; }
        /* Keep text cursors for editable controls for accessibility */
        body input,
        body textarea,
        body select,
        body [contenteditable="true"],
        body [role="textbox"] {
          cursor: text !important;
        }
      `;
      document.head.appendChild(style);
      return () => {
        document.body.style.cursor = 'auto';
        const customCursorStyle = document.getElementById('custom-cursor-style');
        if (customCursorStyle) {
          customCursorStyle.remove();
        }
      };
    }
  }, [isFinePointer]);

  if (!isFinePointer) return null;

  let scale = 1;
  if (isHovered) {
    scale = 0.8;
  } else if (isPointer) {
    scale = 1.5;
  }

  const backgroundColor = isHovered ? "hsl(var(--primary))" : "transparent";

  return (
    <motion.div
      className="fixed top-0 left-0 w-8 h-8 rounded-full border-2 border-primary pointer-events-none z-[99999] mix-blend-difference"
      style={{
        x: cursorX,
        y: cursorY,
      }}
      animate={{
        scale,
        backgroundColor,
        opacity: isPointer ? 0.5 : 1
      }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
    />
  );
}
