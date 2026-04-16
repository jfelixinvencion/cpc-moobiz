"use client";

import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

const MOUSE_REVEAL_ZONE_PX = 10;
const HEADER_TRANSITION = "transform 0.3s ease";
const PADDING_TRANSITION = "padding-top 0.3s ease";

function shouldShowHeader(clientY: number, isInsideHeader: boolean) {
  return clientY < MOUSE_REVEAL_ZONE_PX || isInsideHeader;
}

type MouseRevealHeaderLayoutProps = {
  header: ReactNode;
  children: ReactNode;
};

/**
 * Header fijo que se muestra/oculta según la posición vertical del puntero
 * (zona superior de la pantalla). El contenido reserva altura con padding-top animado.
 */
export function MouseRevealHeaderLayout({ header, children }: MouseRevealHeaderLayoutProps) {
  const [headerVisible, setHeaderVisible] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(0);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const isMouseInHeader = useRef(false);
  const lastClientYRef = useRef(0);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      lastClientYRef.current = event.clientY;
      setHeaderVisible((prev) => {
        const next = shouldShowHeader(event.clientY, isMouseInHeader.current);
        return prev === next ? prev : next;
      });
    };
    document.addEventListener("mousemove", onMouseMove);
    return () => document.removeEventListener("mousemove", onMouseMove);
  }, []);

  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => {
      const h = el.getBoundingClientRect().height;
      setHeaderHeight((prev) => (Math.abs(prev - h) < 0.5 ? prev : h));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <>
      <div
        ref={headerRef}
        className="bg-[#0b1131] shadow-md"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          transform: headerVisible ? "translateY(0)" : "translateY(-100%)",
          transition: HEADER_TRANSITION,
        }}
        onMouseEnter={() => {
          isMouseInHeader.current = true;
          setHeaderVisible((prev) => (prev ? prev : true));
        }}
        onMouseLeave={() => {
          isMouseInHeader.current = false;
          setHeaderVisible((prev) => {
            const next = shouldShowHeader(lastClientYRef.current, isMouseInHeader.current);
            return prev === next ? prev : next;
          });
        }}
      >
        {header}
      </div>
      <div
        className="flex min-h-0 flex-1 flex-col"
        style={{
          paddingTop: headerVisible ? headerHeight : 0,
          transition: PADDING_TRANSITION,
        }}
      >
        {children}
      </div>
    </>
  );
}
