import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowDownWideNarrow,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  ExternalLink,
  Info,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import type {
  Product,
  ProductDetail,
  ProductInput,
  ProductList,
  ProductOptions,
} from "../shared/contracts";
import { api, errorMessage, isAborted, plainText } from "./api";
import {
  BackLink,
  Badge,
  ConfirmDialog,
  dateLabel,
  EmptyState,
  ErrorPanel,
  NativeLink,
  Notice,
  PageHeader,
  ProductImage,
  Spinner,
} from "./ui";

export function ProductsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const q = searchParams.get("q") || "";
  const group = searchParams.get("group") || "";
  const status = ["active", "disabled"].includes(
    searchParams.get("status") || "",
  )
    ? searchParams.get("status")!
    : "all";
  const sort = ["name", "code"].includes(searchParams.get("sort") || "")
    ? searchParams.get("sort")!
    : "-modified";
  const page = Math.max(
    1,
    Number.parseInt(searchParams.get("page") || "1", 10) || 1,
  );
  const [search, setSearch] = useState(q);
  const [result, setResult] = useState<ProductList | null>(null);
  const [options, setOptions] = useState<ProductOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [optionsError, setOptionsError] = useState("");
  const [notice, setNotice] = useState(
    (location.state as { notice?: string } | null)?.notice || "",
  );
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;
  useEffect(() => {
    setSearch(q);
  }, [q]);
  useEffect(() => {
    if (search === q) return;
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams(searchParamsRef.current);
      if (search.trim()) next.set("q", search.trim());
      else next.delete("q");
      next.delete("page");
      setSearchParams(next, { replace: true });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search, q, setSearchParams]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      q,
      group,
      status,
      sort,
      page: String(page),
      pageSize: "20",
    });
    api<ProductList>(`/products?${params}`, { signal: controller.signal })
      .then(setResult)
      .catch((err) => {
        if (!isAborted(err)) setError(errorMessage(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [q, group, status, sort, page, attempt]);
  useEffect(() => {
    const controller = new AbortController();
    setOptionsError("");
    api<{ data: ProductOptions }>("/product-options", {
      signal: controller.signal,
    })
      .then((value) => setOptions(value.data))
      .catch((err) => {
        if (!isAborted(err)) setOptionsError(errorMessage(err));
      });
    return () => controller.abort();
  }, [attempt]);
  function filter(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    setSearchParams(next);
    setNotice("");
  }
  function movePage(nextPage: number) {
    const next = new URLSearchParams(searchParams);
    next.set("page", String(nextPage));
    setSearchParams(next);
    setNotice("");
  }
  const filtered = Boolean(q || group || status !== "all");
  return (
    <>
      <PageHeader
        eyebrow="KATALOG YÖNETİMİ"
        title="Ürünler"
        description="Envanterinizi inceleyin, ürün bilgilerinizi güncel tutun."
      >
        <button
          className="button secondary refresh-button"
          onClick={() => setAttempt((x) => x + 1)}
          disabled={loading}
          aria-label="Ürünleri yenile"
        >
          <RefreshCw size={17} className={loading ? "spin" : ""} />
          <span>Yenile</span>
        </button>
        <Link to="/products/new" className="button primary">
          <Plus size={18} />
          Yeni ürün
        </Link>
      </PageHeader>
      {notice && !loading && !error && <Notice>{notice}</Notice>}
      <div className="catalog-context">
        <div>
          <span className="context-dot" />
          <span>ERPNext ürün envanteri</span>
        </div>
        <span>Şablonlar ve varyantlar dahil</span>
      </div>
      <section className="panel products-panel" aria-label="Ürün listesi">
        <div className="table-toolbar">
          <div className="search-field">
            <Search size={18} />
            <input
              aria-label="Ürün ara"
              value={search}
              maxLength={100}
              placeholder="Ürün adı veya kodu ara…"
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <button
                className="icon-button"
                aria-label="Aramayı temizle"
                onClick={() => setSearch("")}
              >
                <X size={16} />
              </button>
            )}
          </div>
          <div className="list-filters">
            <select
              aria-label="Ürün grubu"
              value={group}
              onChange={(event) => filter("group", event.target.value)}
              disabled={!options}
            >
              <option value="">Tüm gruplar</option>
              {options?.itemGroups.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <select
              aria-label="Ürün durumu"
              value={status}
              onChange={(event) => filter("status", event.target.value)}
            >
              <option value="all">Tüm durumlar</option>
              <option value="active">Aktif</option>
              <option value="disabled">Pasif</option>
            </select>
            <div className="sort-select">
              <ArrowDownWideNarrow size={16} />
              <select
                aria-label="Sıralama"
                value={sort}
                onChange={(event) => filter("sort", event.target.value)}
              >
                <option value="-modified">Son güncellenen</option>
                <option value="name">Ürün adına göre</option>
                <option value="code">Ürün koduna göre</option>
              </select>
            </div>
          </div>
        </div>
        {optionsError && (
          <div className="inline-warning" role="status">
            <Info size={16} />
            Grup filtresi yüklenemedi. {optionsError}
          </div>
        )}
        {loading ? (
          <Spinner label="Ürünler ERPNext’ten alınıyor…" />
        ) : error ? (
          <ErrorPanel message={error} retry={() => setAttempt((x) => x + 1)} />
        ) : !result?.data.length ? (
          <EmptyState
            title={
              filtered
                ? "Aramanıza uygun ürün yok"
                : page > 1
                  ? "Bu sayfada ürün yok"
                  : "İlk ürününüzü ekleyin"
            }
            description={
              filtered
                ? "Farklı bir arama deneyin veya filtreleri temizleyin."
                : page > 1
                  ? "Önceki sayfaya dönerek devam edebilirsiniz."
                  : "Ürün kodu, adı ve grubunu belirleyerek ERPNext envanterinize ekleyin."
            }
          >
            {filtered ? (
              <button
                className="button secondary"
                onClick={() => {
                  setSearch("");
                  setSearchParams({});
                }}
              >
                Filtreleri temizle
              </button>
            ) : page > 1 ? (
              <button
                className="button secondary"
                onClick={() => movePage(page - 1)}
              >
                Önceki sayfa
              </button>
            ) : (
              <Link className="button primary" to="/products/new">
                <Plus size={17} />
                Yeni ürün
              </Link>
            )}
          </EmptyState>
        ) : (
          <>
            <div className="desktop-table">
              <table>
                <thead>
                  <tr>
                    <th>Ürün</th>
                    <th>Grup</th>
                    <th>Tür</th>
                    <th>Durum</th>
                    <th>Güncelleme</th>
                    <th>
                      <span className="sr-only">İşlemler</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.map((product) => (
                    <tr key={product.id}>
                      <td>
                        <Link
                          className="product-table-title"
                          to={`/products/${encodeURIComponent(product.id)}`}
                        >
                          <ProductImage product={product} />
                          <span>
                            <strong>{product.name}</strong>
                            <small>{product.code}</small>
                          </span>
                        </Link>
                      </td>
                      <td>{product.group}</td>
                      <td>
                        <span className="type-label">
                          {product.hasVariants
                            ? "Varyant şablonu"
                            : product.variantOf
                              ? "Varyant"
                              : product.isStockItem
                                ? "Stok ürünü"
                                : "Hizmet / stoksuz"}
                        </span>
                      </td>
                      <td>
                        <Badge product={product} />
                      </td>
                      <td>
                        <span className="date-text">
                          {dateLabel(product.modified)}
                        </span>
                      </td>
                      <td>
                        <Link
                          className="icon-button table-edit"
                          to={`/products/${encodeURIComponent(product.id)}/edit`}
                          aria-label={`${product.name} düzenle`}
                        >
                          <Pencil size={16} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="product-mobile-list">
              {result.data.map((product) => (
                <article className="product-mobile-card" key={product.id}>
                  <Link
                    to={`/products/${encodeURIComponent(product.id)}`}
                    className="mobile-product-link"
                  >
                    <ProductImage product={product} />
                    <div>
                      <h2>{product.name}</h2>
                      <p>{product.code}</p>
                    </div>
                    <ChevronRight size={18} />
                  </Link>
                  <div className="mobile-product-meta">
                    <span>{product.group}</span>
                    <Badge product={product} />
                  </div>
                </article>
              ))}
            </div>
            <div className="table-pagination">
              <span>
                Bu sayfada <strong>{result.data.length}</strong> ürün
                <span className="pagination-page"> · Sayfa {page}</span>
              </span>
              <div>
                <button
                  className="button secondary small"
                  disabled={page <= 1}
                  onClick={() => movePage(page - 1)}
                >
                  <ArrowLeft size={15} />
                  <span>Önceki</span>
                </button>
                <button
                  className="button secondary small"
                  disabled={!result.meta.hasMore}
                  onClick={() => movePage(page + 1)}
                >
                  <span>Sonraki</span>
                  <ArrowRight size={15} />
                </button>
              </div>
            </div>
          </>
        )}
      </section>
      <p className="catalog-hint">
        <Info size={15} />
        <span>
          Vitrinde yalnızca yayımlanacak gruptaki aktif satış ürünleri görünür
          {options?.publicGroup ? `: ${options.publicGroup}` : "."}
        </span>
      </p>
    </>
  );
}

export function ProductDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [detail, setDetail] = useState<ProductDetail["data"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  type VariantPage = Pick<ProductList["meta"], "page" | "pageSize" | "hasMore">;
  const [variantsMeta, setVariantsMeta] = useState<VariantPage | null>(null);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [variantsError, setVariantsError] = useState("");
  const variantsRequest = useRef<AbortController | null>(null);
  const notice = (location.state as { notice?: string } | null)?.notice;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setDetail(null);
    setConfirm(false);
    setVariantsMeta(null);
    setVariantsLoading(false);
    setVariantsError("");
    api<
      ProductDetail & {
        meta: ProductDetail["meta"] & { variants?: VariantPage };
      }
    >(`/products/${encodeURIComponent(id)}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        setDetail(result.data);
        setVariantsMeta(result.meta.variants || null);
      })
      .catch((err) => {
        if (!isAborted(err)) setError(errorMessage(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      variantsRequest.current?.abort();
      variantsRequest.current = null;
    };
  }, [id, attempt]);
  async function loadMoreVariants() {
    if (!variantsMeta?.hasMore || variantsRequest.current) return;
    const controller = new AbortController();
    variantsRequest.current = controller;
    setVariantsLoading(true);
    setVariantsError("");
    const nextPage = variantsMeta.page + 1;
    const params = new URLSearchParams({
      page: String(nextPage),
      pageSize: String(variantsMeta.pageSize),
    });
    try {
      const result = await api<ProductList>(
        `/products/${encodeURIComponent(id)}/variants?${params}`,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      if (
        result.meta.page !== nextPage ||
        result.meta.pageSize !== variantsMeta.pageSize
      ) {
        throw new Error("Varyant sayfası doğrulanamadı. Yeniden deneyin.");
      }
      setDetail((current) => {
        if (!current || current.product.id !== id) return current;
        const merged = new Map(
          current.variants.map((variant) => [variant.id, variant]),
        );
        for (const variant of result.data) merged.set(variant.id, variant);
        return { ...current, variants: [...merged.values()] };
      });
      setVariantsMeta(result.meta);
    } catch (error) {
      if (!controller.signal.aborted && !isAborted(error))
        setVariantsError(errorMessage(error));
    } finally {
      if (variantsRequest.current === controller) {
        variantsRequest.current = null;
        setVariantsLoading(false);
      }
    }
  }
  async function remove() {
    setDeleting(true);
    setDeleteError("");
    try {
      await api(`/products/${encodeURIComponent(id)}`, { method: "DELETE" });
      navigate("/products", {
        replace: true,
        state: { notice: "Ürün ERPNext’ten silindi." },
      });
    } catch (err) {
      setDeleteError(errorMessage(err));
    } finally {
      setDeleting(false);
    }
  }
  if (loading)
    return (
      <>
        <BackLink />
        <Spinner label="Ürün bilgileri alınıyor…" />
      </>
    );
  if (error || !detail)
    return (
      <>
        <BackLink />
        <ErrorPanel
          message={error || "Ürün bulunamadı."}
          retry={() => setAttempt((x) => x + 1)}
        />
      </>
    );
  const { product, variants } = detail;
  return (
    <>
      <BackLink />
      <PageHeader
        eyebrow={product.code}
        title={product.name}
        description="ERPNext’te kayıtlı ürün bilgileri ve varyantları."
      >
        <Link
          className="button primary"
          to={`/products/${encodeURIComponent(id)}/edit`}
        >
          <Pencil size={17} />
          Düzenle
        </Link>
      </PageHeader>
      {notice && <Notice>{notice}</Notice>}
      <div className="detail-layout">
        <section className="panel detail-main">
          <div className="detail-image-wrap">
            <ProductImage product={product} large />
            <Badge product={product} />
            {!product.image && (
              <span className="image-empty-caption">
                Ürün görseli eklenmemiş
              </span>
            )}
          </div>
          <div className="detail-description">
            <p className="eyebrow">ÜRÜN HAKKINDA</p>
            <h2>Açıklama</h2>
            <p>
              {plainText(product.description) ||
                "Bu ürün için açıklama eklenmemiş."}
            </p>
            {product.attributes.length > 0 && (
              <div className="attribute-list">
                {product.attributes.map((attribute, i) => (
                  <div key={`${attribute.name}-${i}`}>
                    <span>{attribute.name}</span>
                    <strong>{attribute.value || "—"}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
        <div className="detail-side">
          <section className="panel detail-facts">
            <h2>Ürün bilgileri</h2>
            <dl>
              <div>
                <dt>Ürün kodu</dt>
                <dd>{product.code}</dd>
              </div>
              <div>
                <dt>Ürün grubu</dt>
                <dd>{product.group}</dd>
              </div>
              <div>
                <dt>Stok birimi</dt>
                <dd>{product.uom}</dd>
              </div>
              <div>
                <dt>Stok takibi</dt>
                <dd>{product.isStockItem ? "Açık" : "Kapalı"}</dd>
              </div>
              <div>
                <dt>Ürün türü</dt>
                <dd>
                  {product.hasVariants
                    ? "Varyant şablonu"
                    : product.variantOf
                      ? "Varyant"
                      : "Standart ürün"}
                </dd>
              </div>
              {product.variantOf && (
                <div>
                  <dt>Şablon</dt>
                  <dd>
                    <Link
                      to={`/products/${encodeURIComponent(product.variantOf)}`}
                    >
                      {product.variantOf}
                    </Link>
                  </dd>
                </div>
              )}
              <div>
                <dt>Son güncelleme</dt>
                <dd>{dateLabel(product.modified)}</dd>
              </div>
            </dl>
            <NativeLink
              href={`https://erp-test.metaframer.net/desk/item/${encodeURIComponent(id)}`}
            >
              ERPNext’te görüntüle
            </NativeLink>
          </section>
          <section className="panel delete-section">
            <h3>Ürünü kaldır</h3>
            <p>
              {product.hasVariants
                ? "Varyant şablonu silinemez; pasife alabilirsiniz."
                : "Silme işlemi kalıcıdır. Bağlı işlem veya kayıt varsa ERPNext silmeyi engelleyebilir."}
            </p>
            <button
              className="button subtle-danger"
              disabled={product.hasVariants}
              onClick={() => {
                setDeleteError("");
                setConfirm(true);
              }}
            >
              <Trash2 size={16} />
              Ürünü sil
            </button>
          </section>
        </div>
      </div>
      <section className="panel variants-panel">
        <div className="panel-heading">
          <div>
            <h2>
              Varyantlar{" "}
              <span className="count-pill">
                {variants.length}
                {variantsMeta?.hasMore ? "+" : ""}
              </span>
            </h2>
            <p>
              {product.hasVariants
                ? "Bu şablona bağlı gerçek ürün kayıtları."
                : "Varyant ilişkileri ERPNext üzerinden yönetilir."}
            </p>
          </div>
          <NativeLink
            href={`https://erp-test.metaframer.net/desk/item/${encodeURIComponent(id)}`}
          >
            ERPNext’te yönet
          </NativeLink>
        </div>
        {variants.length ? (
          <div className="variant-list">
            {variants.map((variant) => (
              <Link
                className="variant-row"
                key={variant.id}
                to={`/products/${encodeURIComponent(variant.id)}`}
              >
                <ProductImage product={variant} />
                <div className="variant-name">
                  <strong>{variant.name}</strong>
                  <span>{variant.code}</span>
                  {variant.attributes.length > 0 && (
                    <small>
                      {variant.attributes
                        .map((attr) => `${attr.name}: ${attr.value}`)
                        .join(" · ")}
                    </small>
                  )}
                </div>
                <Badge product={variant} />
                <ChevronRight size={17} />
              </Link>
            ))}
          </div>
        ) : (
          <div className="variant-empty">
            Bu ürüne bağlı varyant bulunmuyor.
          </div>
        )}
        {variantsError && <ErrorPanel message={variantsError} />}
        {variantsMeta?.hasMore && (
          <div className="table-pagination">
            <span aria-live="polite">{variants.length} varyant yüklendi</span>
            <button
              className="button secondary"
              disabled={variantsLoading}
              onClick={loadMoreVariants}
            >
              {variantsLoading
                ? "Varyantlar yükleniyor…"
                : variantsError
                  ? "Yeniden dene"
                  : "Daha fazla varyant"}
            </button>
          </div>
        )}
      </section>
      {confirm && (
        <ConfirmDialog
          title="Ürün silinsin mi?"
          busy={deleting}
          error={deleteError}
          onClose={() => setConfirm(false)}
          onConfirm={remove}
        >
          <p>
            <strong>{product.name}</strong> ({product.code}) ERPNext
            envanterinden kalıcı olarak silinecek.
          </p>
          <p>
            Bu işlem geri alınamaz. Ürünü daha sonra kullanmak istiyorsanız
            düzenleyerek pasife alabilirsiniz.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}

const emptyInput: ProductInput = {
  code: "",
  name: "",
  description: "",
  group: "",
  uom: "",
  image: null,
  disabled: false,
  isStockItem: true,
};
type FieldErrors = Partial<Record<keyof ProductInput, string>>;

export function ProductFormPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const [form, setForm] = useState<ProductInput>(emptyInput);
  const [original, setOriginal] = useState<Product | null>(null);
  const [options, setOptions] = useState<ProductOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [fields, setFields] = useState<FieldErrors>({});
  const [attempt, setAttempt] = useState(0);
  const [dirty, setDirty] = useState(false);
  const formElement = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setSaveError("");
    setFields({});
    setDirty(false);
    setOriginal(null);
    Promise.all([
      api<{ data: ProductOptions }>("/product-options", {
        signal: controller.signal,
      }),
      id
        ? api<ProductDetail>(`/products/${encodeURIComponent(id)}`, {
            signal: controller.signal,
          })
        : Promise.resolve(null),
    ])
      .then(([available, result]) => {
        setOptions(available.data);
        if (result) {
          const product = result.data.product;
          setOriginal(product);
          setForm({
            code: product.code,
            name: product.name,
            description: product.description,
            group: product.group,
            uom: product.uom,
            image: product.image,
            disabled: product.disabled,
            isStockItem: product.isStockItem,
          });
        } else
          setForm({
            ...emptyInput,
            group: available.data.itemGroups.includes(
              available.data.publicGroup,
            )
              ? available.data.publicGroup
              : "",
            uom: available.data.uoms.includes("Nos")
              ? "Nos"
              : available.data.uoms.length === 1
                ? available.data.uoms[0]
                : "",
          });
      })
      .catch((err) => {
        if (!isAborted(err)) setError(errorMessage(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, attempt]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function update<K extends keyof ProductInput>(
    key: K,
    value: ProductInput[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setFields((current) => ({ ...current, [key]: undefined }));
    setSaveError("");
  }
  function cancel() {
    if (
      !dirty ||
      window.confirm(
        "Kaydedilmemiş değişiklikleriniz var. Sayfadan ayrılmak istiyor musunuz?",
      )
    )
      navigate(id ? `/products/${encodeURIComponent(id)}` : "/products");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const errors: FieldErrors = {};
    for (const key of ["code", "name", "group", "uom"] as const)
      if (!form[key].trim()) errors[key] = "Bu alan zorunludur.";
    if (form.image && !/^https?:\/\//i.test(form.image))
      errors.image =
        "http:// veya https:// ile başlayan bir görsel bağlantısı girin.";
    if (
      options &&
      !options.itemGroups.includes(form.group) &&
      form.group !== original?.group
    )
      errors.group = "Listeden geçerli bir ürün grubu seçin.";
    if (
      options &&
      !options.uoms.includes(form.uom) &&
      form.uom !== original?.uom
    )
      errors.uom = "Listeden geçerli bir birim seçin.";
    setFields(errors);
    if (Object.keys(errors).length) {
      window.setTimeout(
        () =>
          formElement.current
            ?.querySelector<HTMLElement>('[aria-invalid="true"]')
            ?.focus(),
        0,
      );
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      const { code, ...rest } = form;
      const normalized = {
        ...rest,
        name: rest.name.trim(),
        image: rest.image?.trim() || null,
      };
      // Only changed fields are patched. In particular, an untouched description
      // must not overwrite ERPNext's rich text with its plain display text.
      const changed = Object.fromEntries(
        Object.entries(normalized).filter(
          ([key, value]) => value !== original?.[key as keyof Product],
        ),
      );
      const body = editing
        ? { ...changed, modified: original?.modified }
        : { ...normalized, code: code.trim() };
      const result = await api<{ data: Product }>(
        editing ? `/products/${encodeURIComponent(id!)}` : "/products",
        { method: editing ? "PATCH" : "POST", body: JSON.stringify(body) },
      );
      setDirty(false);
      navigate(`/products/${encodeURIComponent(result.data.id)}`, {
        replace: true,
        state: {
          notice: editing
            ? "Değişiklikler ERPNext’e kaydedildi."
            : "Ürün ERPNext’te oluşturuldu.",
        },
      });
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }
  const fieldProps = (key: keyof ProductInput) => ({
    "aria-invalid": !!fields[key],
    "aria-describedby": fields[key] ? `${key}-error` : undefined,
  });
  const message = (key: keyof ProductInput) =>
    fields[key] && (
      <small id={`${key}-error`} className="field-error">
        {fields[key]}
      </small>
    );
  const backTo = id ? `/products/${encodeURIComponent(id)}` : "/products";
  if (loading)
    return (
      <>
        <BackLink to={backTo} />
        <Spinner
          label={
            editing
              ? "Ürün düzenlemeye hazırlanıyor…"
              : "Ürün seçenekleri alınıyor…"
          }
        />
      </>
    );
  if (error || !options)
    return (
      <>
        <BackLink to={backTo} />
        <ErrorPanel
          message={error || "Ürün seçenekleri alınamadı."}
          retry={() => setAttempt((x) => x + 1)}
        />
      </>
    );
  return (
    <>
      <button className="back-link back-button" onClick={cancel}>
        ← {editing ? "Ürün detayına dön" : "Ürünlere dön"}
      </button>
      <PageHeader
        eyebrow="KATALOG YÖNETİMİ"
        title={editing ? "Ürünü düzenle" : "Yeni ürün"}
        description={
          editing
            ? "Ürün bilgilerini düzenleyin ve ERPNext’e kaydedin."
            : "Envanterinize yeni bir ürün ekleyin."
        }
      />
      <form
        ref={formElement}
        noValidate
        onSubmit={submit}
        className="product-form"
      >
        <div className="form-main">
          <section className="panel form-section">
            <div className="form-section-heading">
              <span className="step-marker">01</span>
              <div>
                <h2>Temel bilgiler</h2>
                <p>Ürününüzü tanımlayan bilgiler.</p>
              </div>
            </div>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="product-name">
                  Ürün adı <span>*</span>
                </label>
                <input
                  id="product-name"
                  name="name"
                  value={form.name}
                  maxLength={140}
                  onChange={(event) => update("name", event.target.value)}
                  placeholder="Örn. Keten çalışma çantası"
                  disabled={saving}
                  {...fieldProps("name")}
                />
                {message("name")}
              </div>
              <div className="field">
                <label htmlFor="product-code">
                  Ürün kodu <span>*</span>
                </label>
                <input
                  id="product-code"
                  name="code"
                  value={form.code}
                  maxLength={140}
                  onChange={(event) => update("code", event.target.value)}
                  placeholder="Örn. URUN-001"
                  readOnly={editing}
                  disabled={saving}
                  {...fieldProps("code")}
                />
                {message("code")}
                <small>
                  {editing
                    ? "Ürün kodu oluşturulduktan sonra bu arayüzden değiştirilemez."
                    : "Envanterinizdeki diğer ürünlerden farklı, benzersiz bir kod."}
                </small>
              </div>
              <div className="field">
                <label htmlFor="product-group">
                  Ürün grubu <span>*</span>
                </label>
                <select
                  id="product-group"
                  name="group"
                  value={form.group}
                  disabled={saving}
                  onChange={(event) => update("group", event.target.value)}
                  {...fieldProps("group")}
                >
                  <option value="">Grup seçin</option>
                  {original?.group &&
                    !options.itemGroups.includes(original.group) && (
                      <option value={original.group}>{original.group}</option>
                    )}
                  {options.itemGroups.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
                {message("group")}
              </div>
              <div className="field">
                <label htmlFor="product-uom">
                  Stok birimi <span>*</span>
                </label>
                <select
                  id="product-uom"
                  name="uom"
                  value={form.uom}
                  disabled={saving || Boolean(original?.variantOf)}
                  onChange={(event) => update("uom", event.target.value)}
                  {...fieldProps("uom")}
                >
                  <option value="">Birim seçin</option>
                  {original?.uom && !options.uoms.includes(original.uom) && (
                    <option value={original.uom}>{original.uom}</option>
                  )}
                  {options.uoms.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
                {message("uom")}
                {original?.variantOf && (
                  <small>Varyant birimi şablon üzerinden yönetilir.</small>
                )}
              </div>
              <div className="field full-width">
                <label htmlFor="product-description">Açıklama</label>
                <textarea
                  id="product-description"
                  name="description"
                  rows={6}
                  maxLength={20000}
                  value={form.description}
                  onChange={(event) =>
                    update("description", event.target.value)
                  }
                  placeholder="Ürünün özelliklerini ve kullanım bilgilerini ekleyin…"
                  disabled={saving}
                />
                <small>
                  İsteğe bağlı. Açıklamayı değiştirirseniz düz metin olarak
                  kaydedilir.
                </small>
              </div>
            </div>
          </section>
          <section className="panel form-section">
            <div className="form-section-heading">
              <span className="step-marker">02</span>
              <div>
                <h2>Görsel</h2>
                <p>Ürününüzü tanıtan bir görsel bağlantısı ekleyin.</p>
              </div>
            </div>
            <div className="form-image-row">
              <ProductImage
                product={{
                  name: form.name || "Ürün görseli önizlemesi",
                  image: form.image,
                }}
              />
              <div className="field">
                <label htmlFor="product-image">Görsel URL’si</label>
                <input
                  id="product-image"
                  name="image"
                  type="url"
                  value={form.image || ""}
                  onChange={(event) =>
                    update("image", event.target.value || null)
                  }
                  placeholder="https://…"
                  disabled={saving}
                  {...fieldProps("image")}
                />
                {message("image")}
                <small>
                  Görselinizin herkese açık http(s) bağlantısını kullanın.
                </small>
              </div>
            </div>
          </section>
        </div>
        <aside className="form-side">
          <section className="panel form-section settings-section">
            <h2>Yayın ve stok</h2>
            <label className="check-row">
              <input
                type="checkbox"
                checked={!form.disabled}
                onChange={(event) => update("disabled", !event.target.checked)}
                disabled={saving}
              />
              <span>
                <strong>Ürün aktif</strong>
                <small>Pasif ürünler vitrin kataloğunda görünmez.</small>
              </span>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={form.isStockItem}
                onChange={(event) =>
                  update("isStockItem", event.target.checked)
                }
                disabled={saving || Boolean(original?.variantOf)}
              />
              <span>
                <strong>Stok takibi</strong>
                <small>Miktarı ERPNext stok hareketleriyle takip edilir.</small>
              </span>
            </label>
          </section>
          <div className="form-note">
            <Info size={18} />
            <div>
              <strong>Vitrinde görünürlük</strong>
              <p>
                {options.publicGroup} grubundaki aktif satış ürünleri
                yayımlanır. Grup seçimi tek başına diğer ERPNext satış
                ayarlarını değiştirmez.
              </p>
            </div>
          </div>
          {(original?.hasVariants || original?.variantOf) && (
            <div className="form-note">
              <ExternalLink size={18} />
              <div>
                <strong>Varyant bilgileri</strong>
                <p>
                  Varyant oluşturma ve özellik düzenleme ERPNext ekranında
                  yapılır.
                </p>
                <NativeLink
                  href={`https://erp-test.metaframer.net/desk/item/${encodeURIComponent(id!)}`}
                >
                  ERPNext’te aç
                </NativeLink>
              </div>
            </div>
          )}
        </aside>
        {saveError && (
          <div className="form-save-error">
            <ErrorPanel compact message={saveError} />
          </div>
        )}
        <footer className="form-savebar">
          <span>
            <span className="required-dot">*</span> Zorunlu alanlar
          </span>
          <div>
            <button
              type="button"
              className="button secondary"
              onClick={cancel}
              disabled={saving}
            >
              Vazgeç
            </button>
            <button className="button primary" type="submit" disabled={saving}>
              {saving
                ? "Kaydediliyor…"
                : editing
                  ? "Değişiklikleri kaydet"
                  : "Ürünü oluştur"}
              {!saving && <ArrowRight size={17} />}
            </button>
          </div>
        </footer>
      </form>
    </>
  );
}
