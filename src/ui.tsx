import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  Box,
  Check,
  LoaderCircle,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { Product } from "../shared/contracts";

export function Spinner({ label = "Yükleniyor…" }: { label?: string }) {
  return (
    <div className="loading-state" role="status">
      <LoaderCircle size={22} className="spin" />
      <span>{label}</span>
    </div>
  );
}
export function ErrorPanel({
  message,
  retry,
  compact = false,
}: {
  message: string;
  retry?: () => void;
  compact?: boolean;
}) {
  return (
    <div className={`error-panel ${compact ? "compact" : ""}`} role="alert">
      <AlertCircle size={21} />
      <div>
        <strong>İşlem tamamlanamadı</strong>
        <p>{message}</p>
        {retry && (
          <button className="button secondary small" onClick={retry}>
            Yeniden dene
          </button>
        )}
      </div>
    </div>
  );
}
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="notice" role="status">
      <Check size={18} />
      <span>{children}</span>
    </div>
  );
}
export function Badge({ product }: { product: Product }) {
  return (
    <span className={`badge ${product.disabled ? "muted" : "green"}`}>
      <span />
      {product.disabled ? "Pasif" : "Aktif"}
    </span>
  );
}
export function ProductImage({
  product,
  large = false,
}: {
  product: Pick<Product, "image" | "name">;
  large?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [product.image]);
  const safeImage =
    product.image && /^https?:\/\//i.test(product.image) ? product.image : null;
  return (
    <div className={`product-image ${large ? "large" : ""}`}>
      {safeImage && !broken ? (
        <img
          src={safeImage}
          alt={product.name}
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : (
        <Box size={large ? 60 : 22} strokeWidth={1.25} />
      )}
    </div>
  );
}
export function PageHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  );
}
export function NativeLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="native-link"
    >
      {children}
      <ArrowUpRight size={15} />
      <span className="sr-only"> (yeni sekmede açılır)</span>
    </a>
  );
}
export function EmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Box size={30} strokeWidth={1.4} />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      {children}
    </div>
  );
}
export function BackLink({
  to = "/products",
  children = "Ürünlere dön",
}: {
  to?: string;
  children?: ReactNode;
}) {
  return (
    <Link className="back-link" to={to}>
      ← {children}
    </Link>
  );
}
export function dateLabel(value: string) {
  const parsed = new Date(
    value.includes("T") ? value : value.replace(" ", "T"),
  );
  return Number.isNaN(parsed.valueOf())
    ? value
    : new Intl.DateTimeFormat("tr-TR", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(parsed);
}

export function ConfirmDialog({
  title,
  children,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  title: string;
  children: ReactNode;
  busy: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  useEffect(() => {
    previous.current = document.activeElement as HTMLElement;
    cancel.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      previous.current?.focus();
    };
  }, []);
  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={dialog}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onClose();
          if (event.key === "Tab") {
            const elements = dialog.current?.querySelectorAll<HTMLElement>(
              "button:not(:disabled), a[href]",
            );
            if (!elements?.length) return;
            const first = elements[0],
              last = elements[elements.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            }
            if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <div className="dialog-title">
          <h2 id="dialog-title">{title}</h2>
          <button
            className="icon-button"
            aria-label="Pencereyi kapat"
            disabled={busy}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <div className="dialog-copy">{children}</div>
        {error && <ErrorPanel compact message={error} />}
        <div className="dialog-actions">
          <button
            ref={cancel}
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            Vazgeç
          </button>
          <button className="button danger" disabled={busy} onClick={onConfirm}>
            {busy ? <LoaderCircle size={17} className="spin" /> : null}
            {busy ? "Siliniyor…" : "Ürünü sil"}
          </button>
        </div>
      </div>
    </div>
  );
}
