import { useRef, type ReactNode } from 'react';

/** Downward drag on the handle (px) that closes the sheet. */
const SWIPE_CLOSE_PX = 60;

interface Props {
  onClose: () => void;
  children: ReactNode;
}

export function BottomSheet({ onClose, children }: Props) {
  const dragStartY = useRef<number | null>(null);
  return (
    <div className="sheet" role="dialog" aria-label="Station details">
      <div
        className="sheet-handle"
        onPointerDown={(e) => {
          dragStartY.current = e.clientY;
        }}
        onPointerUp={(e) => {
          if (dragStartY.current !== null && e.clientY - dragStartY.current > SWIPE_CLOSE_PX) onClose();
          dragStartY.current = null;
        }}
      />
      <button type="button" className="sheet-close" aria-label="Close" onClick={onClose}>
        ×
      </button>
      {children}
    </div>
  );
}
