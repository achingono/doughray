import { useEffect, useState } from "react";
import { motion, useSpring } from "framer-motion";

export function CustomCursor() {
  const [isHovered, setIsHovered] = useState(false);
  const [isPointer, setIsPointer] = useState(false);
  const [isFinePointer, setIsFinePointer] = useState(() => window.matchMedia("(pointer: fine)").matches);

  const springConfig = { damping: 25, stiffness: 300, mass: 0.5 };
  const cursorX = useSpring(-100, springConfig);
  const cursorY = useSpring(-100, springConfig);

  useEffect(() => {
    const mediaQueryList = window.matchMedia("(pointer: fine)");

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
        const computedStyle = window.getComputedStyle(target);
        if (computedStyle.cursor === "pointer" || target.tagName.toLowerCase() === "a" || target.tagName.toLowerCase() === "button") {
          setIsPointer(true);
        } else {
          setIsPointer(false);
        }
      };

      const handleMouseDown = () => setIsHovered(true);
      const handleMouseUp = () => setIsHovered(false);

      window.addEventListener("mousemove", moveCursor);
      window.addEventListener("mouseover", handleMouseOver);
      window.addEventListener("mousedown", handleMouseDown);
      window.addEventListener("mouseup", handleMouseUp);

      return () => {
        window.removeEventListener("mousemove", moveCursor);
        window.removeEventListener("mouseover", handleMouseOver);
        window.removeEventListener("mousedown", handleMouseDown);
        window.removeEventListener("mouseup", handleMouseUp);
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
        * { cursor: none !important; }
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

  return (
    <motion.div
      className="fixed top-0 left-0 w-8 h-8 rounded-full border-2 border-primary pointer-events-none z-[99999] mix-blend-difference"
      style={{
        x: cursorX,
        y: cursorY,
      }}
      animate={{
        scale: isHovered ? 0.8 : isPointer ? 1.5 : 1,
        backgroundColor: isHovered ? "hsl(var(--primary))" : isPointer ? "transparent" : "transparent",
        opacity: isPointer ? 0.5 : 1
      }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
    />
  );
}
