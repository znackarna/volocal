export type RecordingMetadataKind =
  | "duration"
  | "language"
  | "model"
  | "segments"
  | "saved"
  | "folder"
  | "error";

/** One icon set shared by Archive cards and the application status footer. */
export default function RecordingMetadataIcon({ kind }: { kind: RecordingMetadataKind }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (kind === "duration") {
    return <svg {...common}><circle cx="8" cy="8" r="5.7" /><path d="M8 4.8V8l2.2 1.4" /></svg>;
  }
  if (kind === "language") {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="5.7" />
        <path d="M2.5 8h11M8 2.3c1.7 1.6 2.5 3.5 2.5 5.7S9.7 12.1 8 13.7M8 2.3C6.3 3.9 5.5 5.8 5.5 8s.8 4.1 2.5 5.7" />
      </svg>
    );
  }
  if (kind === "model") {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="5.7" />
        <circle cx="8" cy="8" r="2.5" />
        <path d="M8 2.3v2M13.7 8h-2M8 13.7v-2M2.3 8h2" />
      </svg>
    );
  }
  if (kind === "segments") {
    return (
      <svg {...common}>
        <path d="m3 5 5-2.4L13 5 8 7.4 3 5Z" />
        <path d="m3 8 5 2.4L13 8M3 11l5 2.4 5-2.4" />
      </svg>
    );
  }
  if (kind === "folder") {
    return (
      <svg {...common}>
        <path d="M2 4.2a.9.9 0 0 1 .9-.9h3.3l1.2 1.4h5.7a.9.9 0 0 1 .9.9v6.3a.9.9 0 0 1-.9.9H2.9a.9.9 0 0 1-.9-.9V4.2Z" />
      </svg>
    );
  }
  if (kind === "saved") {
    return (
      <svg {...common}>
        <path d="M3 2.5h8.2L13.5 4.8v8.7h-11v-11Z" />
        <path d="M5 2.5v4h6v-4M5.2 13.5V9h5.6v4.5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M8 2.3 14 13H2L8 2.3Z" />
      <path d="M8 6v3.2M8 11.4h.01" />
    </svg>
  );
}
