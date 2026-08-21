import { useEffect } from "react";

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

export interface LightboxItem {
  name: string;
  mimeType: string;
  size?: number;
}

export function AttachmentLightbox({
  item,
  url,
  onClose,
}: {
  item: LightboxItem;
  url: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isImage = item.mimeType.startsWith("image/");

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 p-8" onClick={onClose}>
      {isImage && url ? (
        <img
          src={url}
          alt={item.name}
          className="max-w-full max-h-full rounded-lg shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <div className="flex flex-col items-center gap-3 text-text-primary" onClick={(e) => e.stopPropagation()}>
          <span className="flex w-16 h-16 text-text-tertiary">
            <FileIcon />
          </span>
          <span className="text-lg font-medium">{item.name}</span>
          {item.size != null && <span className="text-sm text-text-tertiary">{(item.size / 1024).toFixed(1)} KB</span>}
        </div>
      )}
      <button
        type="button"
        className="icon-button absolute top-4 right-4 text-white"
        onClick={onClose}
        aria-label="Close"
        title="Close"
      >
        <CloseIcon />
      </button>
    </div>
  );
}

export function AttachmentFileIcon() {
  return <FileIcon />;
}
