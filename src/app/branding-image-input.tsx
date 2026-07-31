"use client";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";
import { FieldError } from "./field-feedback";
import { FilePickerButton } from "./file-picker-button";

export interface BrandingImageInputProps {
  label: string; // accessible name for the file input
  removeLabel?: string; // accessible name for the remove button (default "Remove")
  value: string | undefined; // current data: URL (or empty)
  onChange: (dataUrl: string) => void;
  onRemove: () => void;
  error: string | null;
  invalidMessage?: string; // message to raise via onError path (caller owns setError)
  onError?: (msg: string) => void;
}

// Raster-only mime allowlist + 512 KB size cap — replicates the validation
// that was inline in appearance-section.tsx (BRANDING_LOGO_FILE_RE /
// BRANDING_LOGO_MAX_BYTES). SVG is excluded on purpose (XSS surface).
const FILE_RE = /^data:image\/(png|jpeg|webp|gif);base64,/i;
const MAX_BYTES = 512 * 1024;

export function BrandingImageInput(props: BrandingImageInputProps) {
  function onFile(file: File) {
    // Cap on the RAW file bytes (matches the original appearance-section check) —
    // NOT the base64 data-URL length, which inflates ~33% and would reject
    // otherwise-valid ~400 KB logos.
    if (file.size > MAX_BYTES) {
      props.onError?.(props.invalidMessage ?? "Invalid image");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      if (!FILE_RE.test(url)) {
        props.onError?.(props.invalidMessage ?? "Invalid image");
        return;
      }
      props.onChange(url);
    };
    reader.readAsDataURL(file);
  }
  return (
    <div className="flex flex-col gap-1">
      {props.value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={props.value} alt="" className="h-10 w-auto max-w-[8rem] object-contain" />
      ) : null}
      <div className="flex items-center gap-2">
        <FilePickerButton
          label={props.label}
          accept="image/png,image/jpeg,image/webp,image/gif"
          onFile={onFile}
        />
        {props.value ? (
          <button
            type="button"
            className={`rounded-md border border-line px-2 py-1 text-sm ${FOCUS_RING} ${TRANSITION}`}
            onClick={props.onRemove}
          >
            {props.removeLabel ?? "Remove"}
          </button>
        ) : null}
      </div>
      {props.error ? (
        <FieldError>{props.error}</FieldError>
      ) : null}
    </div>
  );
}
