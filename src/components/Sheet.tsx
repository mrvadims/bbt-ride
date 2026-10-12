// Bottom sheet dialog using <dialog>: modal, Escape closes, focus is trapped and returned by the browser.
import { type ReactNode, useLayoutEffect, useRef } from "react";

export function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  // Layout effect: its cleanup closes the dialog before React removes it, so the browser returns focus.
  useLayoutEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape is handled natively by <dialog> (onCancel)
    <dialog
      ref={ref}
      className="sheet"
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // click on the backdrop
      }}
    >
      <div className="sheet-card">{children}</div>
    </dialog>
  );
}
