import { useEffect, useMemo, useState } from "react";
import { AttachmentLightbox, AttachmentFileIcon } from "./AttachmentLightbox";
import type { SentAttachment } from "../types/message";

export interface PendingAttachment {
  id: string;
  file: File;
  status: "uploading" | "done" | "error";
  sent: SentAttachment | null;
  // Supabase Storage object key, set once uploaded — needed to delete the
  // object again if this attachment is removed before the message is sent.
  storagePath: string | null;
}

function UploadSpinner() {
  return (
    <span className="absolute inset-0 flex items-center justify-center bg-black/40 rounded">
      <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
    </span>
  );
}

export function AttachmentStrip({
  items,
  onRemove,
}: {
  items: PendingAttachment[];
  onRemove: (id: string) => void;
}) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const imageUrls = useMemo(
    () => items.map(({ file }) => (file.type.startsWith("image/") ? URL.createObjectURL(file) : null)),
    [items]
  );
  useEffect(() => {
    return () => imageUrls.forEach((url) => url && URL.revokeObjectURL(url));
  }, [imageUrls]);

  if (items.length === 0) return null;

  const previewItem = previewIndex != null ? items[previewIndex] : null;
  const previewUrl = previewIndex != null ? imageUrls[previewIndex] : null;

  return (
    <>
      <div className="flex flex-wrap gap-[0.5em]">
        {items.map((item, i) => {
          const url = imageUrls[i];
          return (
            <span
              key={item.id}
              className={`inline-flex items-center gap-[0.4em] text-[0.78em] text-text-secondary bg-bg-secondary pr-[0.6em] py-[0.3em] pl-[0.3em] rounded-lg [&>svg]:w-3 [&>svg]:h-3 [&>svg]:stroke-current [&>svg]:fill-none [&>svg]:stroke-2 ${
                item.status === "error" ? "text-conflict" : ""
              }`}
            >
              <button
                type="button"
                onClick={() => setPreviewIndex(i)}
                title={item.status === "error" ? "Upload failed" : "Preview"}
                className="appearance-none border-0 outline-none bg-transparent p-0 cursor-pointer flex items-center gap-[0.4em]"
              >
                <span className="relative flex w-6 h-6 items-center justify-center shrink-0 rounded overflow-hidden">
                  {url ? (
                    <img src={url} alt={item.file.name} className="w-6 h-6 rounded object-cover shrink-0" />
                  ) : (
                    <span className="flex w-6 h-6 items-center justify-center text-text-tertiary [&>svg]:w-4 [&>svg]:h-4">
                      <AttachmentFileIcon />
                    </span>
                  )}
                  {item.status === "uploading" && <UploadSpinner />}
                </span>
                {item.file.name}
              </button>
              <button
                type="button"
                className="appearance-none border-0 outline-none bg-transparent p-0 text-text-tertiary text-[1.1em] leading-none hover:text-text-primary"
                onClick={() => onRemove(item.id)}
                aria-label={`Remove ${item.file.name}`}
              >
                ×
              </button>
            </span>
          );
        })}
      </div>
      {previewItem && (
        <AttachmentLightbox
          item={{ name: previewItem.file.name, mimeType: previewItem.file.type, size: previewItem.file.size }}
          url={previewUrl}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </>
  );
}
