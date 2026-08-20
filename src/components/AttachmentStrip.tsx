import { useEffect, useMemo, useState } from "react";

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

function AttachmentLightbox({ file, url, onClose }: { file: File; url: string | null; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isImage = file.type.startsWith("image/");

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 p-8" onClick={onClose}>
      {isImage && url ? (
        <img
          src={url}
          alt={file.name}
          className="max-w-full max-h-full rounded-lg shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <div className="flex flex-col items-center gap-3 text-text-primary" onClick={(e) => e.stopPropagation()}>
          <span className="flex w-16 h-16 text-text-tertiary">
            <FileIcon />
          </span>
          <span className="text-lg font-medium">{file.name}</span>
          <span className="text-sm text-text-tertiary">{(file.size / 1024).toFixed(1)} KB</span>
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

export function AttachmentStrip({ files, onRemove }: { files: File[]; onRemove: (file: File) => void }) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const imageUrls = useMemo(
    () => files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : null)),
    [files]
  );
  useEffect(() => {
    return () => imageUrls.forEach((url) => url && URL.revokeObjectURL(url));
  }, [imageUrls]);

  if (files.length === 0) return null;

  const previewFile = previewIndex != null ? files[previewIndex] : null;
  const previewUrl = previewIndex != null ? imageUrls[previewIndex] : null;

  return (
    <>
      <div className="flex flex-wrap gap-[0.5em]">
        {files.map((file, i) => {
          const url = imageUrls[i];
          return (
            <span
              key={`${file.name}-${i}`}
              className="inline-flex items-center gap-[0.4em] text-[0.78em] text-text-secondary bg-bg-secondary pr-[0.6em] py-[0.3em] pl-[0.3em] rounded-lg [&>svg]:w-3 [&>svg]:h-3 [&>svg]:stroke-current [&>svg]:fill-none [&>svg]:stroke-2"
            >
              <button
                type="button"
                onClick={() => setPreviewIndex(i)}
                title="Preview"
                className="appearance-none border-0 outline-none bg-transparent p-0 cursor-pointer flex items-center gap-[0.4em]"
              >
                {url ? (
                  <img src={url} alt={file.name} className="w-6 h-6 rounded object-cover shrink-0" />
                ) : (
                  <span className="flex w-6 h-6 items-center justify-center shrink-0 text-text-tertiary [&>svg]:w-4 [&>svg]:h-4">
                    <FileIcon />
                  </span>
                )}
                {file.name}
              </button>
              <button
                type="button"
                className="appearance-none border-0 outline-none bg-transparent p-0 text-text-tertiary text-[1.1em] leading-none hover:text-text-primary"
                onClick={() => onRemove(file)}
                aria-label={`Remove ${file.name}`}
              >
                ×
              </button>
            </span>
          );
        })}
      </div>
      {previewFile && <AttachmentLightbox file={previewFile} url={previewUrl} onClose={() => setPreviewIndex(null)} />}
    </>
  );
}
