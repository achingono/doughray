import { useEffect } from "react";
import Lenis from "lenis";

export function SmoothScroll({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Small offset used by this exponential ease-out variant so the curve
    // reliably reaches 1 when clamped at the end of the animation.
    const EXPONENTIAL_EASE_OUT_OFFSET = 1.001;

    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) =>
        Math.min(1, EXPONENTIAL_EASE_OUT_OFFSET - Math.pow(2, -10 * t)),
      orientation: "vertical",
      gestureOrientation: "vertical",
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 2,
    });

    let rafId: number;

    function raf(time: number) {
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    }

    rafId = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(rafId);
      lenis.destroy();
    };
  }, []);

  return <>{children}</>;
}
