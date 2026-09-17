import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Boxes,
  ChevronRight,
  LayoutGrid,
  LogOut,
  Menu,
  Package,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  Link,
  NavLink,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useAuth } from "./auth";
import { api, errorMessage, isAborted } from "./api";
import { EmptyState, ErrorPanel, PageHeader, Spinner } from "./ui";
import { LocalSetupPage } from "./setup";
import { ProductDetailPage, ProductFormPage, ProductsPage } from "./products";

function Brand({ light = false }: { light?: boolean }) {
  return (
    <span className={`brand ${light ? "light" : ""}`}>
      <span className="brand-symbol">
        <Boxes size={23} strokeWidth={1.6} />
      </span>
      <span>
        metaframer<span className="brand-caption">WORKSPACE</span>
      </span>
    </span>
  );
}

function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const logoutNotice = auth.logoutNotice && (
    <div className="logout-notice" role="status">
      <span>{auth.logoutNotice}</span>
      <button
        className="icon-button"
        aria-label="Çıkış bilgilendirmesini kapat"
        onClick={auth.clearLogoutNotice}
      >
        <X size={17} />
      </button>
    </div>
  );
  if (auth.loading)
    return (
      <div className="full-state">
        <Spinner label="Oturum kontrol ediliyor…" />
      </div>
    );
  if (auth.error)
    return (
      <div className="full-state">
        <div className="login-error-state">
          {logoutNotice}
          <ErrorPanel message={auth.error} retry={auth.retry} />
        </div>
      </div>
    );
  if (auth.session) return <Navigate to="/products" replace />;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await auth.login(username.trim(), password);
      setPassword("");
      const next = (location.state as { from?: string } | null)?.from;
      navigate(
        next?.startsWith("/products") || next === "/apps" ? next : "/products",
        { replace: true },
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-story">
        <Brand light />
        <div className="login-story-copy">
          <span className="story-label">
            <span /> ERPNext çalışma alanınız
          </span>
          <h1>
            İşinizin merkezine
            <br />
            <em>hoş geldiniz.</em>
          </h1>
          <p>
            Ürünlerinizi düzenleyin, kataloğunuzu güncelleyin ve
            uygulamalarınıza tek bir yerden ulaşın.
          </p>
          <div className="story-product">
            <div className="story-product-icon">
              <Package size={32} strokeWidth={1.4} />
            </div>
            <div>
              <strong>Tek kaynak, güncel bilgi</strong>
              <p>Ürün işlemleri doğrudan ERPNext’e kaydedilir.</p>
            </div>
          </div>
        </div>
        <div className="login-footnote">
          METAFRAMER <span>Yönetim çalışma alanı · v1</span>
        </div>
      </section>
      <section className="login-form-section">
        <div className="login-mobile-brand">
          <Brand />
        </div>
        <div className="login-form-wrap">
          <p className="eyebrow">YÖNETİM PANELİ</p>
          <h2>Hesabınıza giriş yapın</h2>
          <p className="muted-text">
            ERPNext kullanıcı bilgilerinizle devam edin.
          </p>
          {logoutNotice}
          <form onSubmit={submit} className="login-form">
            <div className="field">
              <label htmlFor="username">E-posta veya kullanıcı adı</label>
              <input
                id="username"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="ornek@sirket.com"
                required
                disabled={busy}
              />
            </div>
            <div className="field">
              <label htmlFor="password">Şifre</label>
              <div className="password-wrap">
                <input
                  id="password"
                  name="password"
                  type={visible ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Şifrenizi girin"
                  required
                  disabled={busy}
                />
                <button
                  type="button"
                  onClick={() => setVisible(!visible)}
                  aria-label={visible ? "Şifreyi gizle" : "Şifreyi göster"}
                >
                  {visible ? "Gizle" : "Göster"}
                </button>
              </div>
            </div>
            {error && <ErrorPanel message={error} compact />}
            <button className="button primary login-submit" disabled={busy}>
              {busy ? "Giriş yapılıyor…" : "Giriş yap"}
              {!busy && <ArrowRight size={18} />}
            </button>
          </form>
          <div className="login-security">
            <ShieldCheck size={19} />
            <span>
              Erişiminiz ERPNext hesabınızdaki yetkilere göre belirlenir.
            </span>
          </div>
          <a
            className="login-backend"
            href="https://erp-test.metaframer.net/login#forgot"
            target="_blank"
            rel="noopener noreferrer"
          >
            Şifrenizi mi unuttunuz?
            <ArrowUpRight size={14} />
            <span className="sr-only"> Yeni sekmede ERPNext’i açar.</span>
          </a>
        </div>
      </section>
    </main>
  );
}

function Workspace() {
  const auth = useAuth();
  const location = useLocation();
  const [drawer, setDrawer] = useState(false);
  const [mobile, setMobile] = useState(
    () => window.matchMedia("(max-width: 700px)").matches,
  );
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const menu = useRef<HTMLButtonElement>(null);
  const aside = useRef<HTMLElement>(null);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 700px)");
    const update = () => {
      setMobile(query.matches);
      if (!query.matches) setDrawer(false);
    };
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    setDrawer(false);
  }, [location.pathname]);
  useEffect(() => {
    if (!drawer) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close =
      aside.current?.querySelector<HTMLButtonElement>(".sidebar-close");
    close?.focus();
    return () => {
      document.body.style.overflow = previous;
      menu.current?.focus();
    };
  }, [drawer]);
  if (auth.loading)
    return (
      <div className="full-state">
        <Spinner label="Çalışma alanı açılıyor…" />
      </div>
    );
  if (auth.error)
    return (
      <div className="full-state">
        <ErrorPanel message={auth.error} retry={auth.retry} />
      </div>
    );
  if (!auth.session)
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  const section = location.pathname === "/apps" ? "Uygulamalar" : "Ürünler";
  async function logout() {
    setLogoutBusy(true);
    setLogoutError("");
    try {
      await auth.logout();
    } catch (err) {
      setLogoutError(errorMessage(err));
    } finally {
      setLogoutBusy(false);
    }
  }
  return (
    <div className="workspace">
      <a className="skip-link" href="#main">
        İçeriğe geç
      </a>
      {drawer && (
        <div className="drawer-backdrop" onClick={() => setDrawer(false)} />
      )}
      <aside
        ref={aside}
        inert={mobile && !drawer}
        className={`sidebar ${drawer ? "open" : ""}`}
        aria-label="Ana menü"
        onKeyDown={(event) => {
          if (!drawer) return;
          if (event.key === "Escape") setDrawer(false);
          if (event.key === "Tab") {
            const elements = Array.from(
              aside.current?.querySelectorAll<HTMLElement>(
                "a[href], button:not(:disabled)",
              ) || [],
            ).filter((el) => el.getClientRects().length);
            const first = elements[0],
              last = elements[elements.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            }
            if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <div className="sidebar-brand">
          <Link to="/products" aria-label="Metaframer ürün yönetimi">
            <Brand light />
          </Link>
          <button
            className="icon-button sidebar-close"
            onClick={() => setDrawer(false)}
            aria-label="Menüyü kapat"
          >
            <X size={21} />
          </button>
        </div>
        <div className="workspace-switch">
          <span className="workspace-avatar">M</span>
          <div>
            <strong>ERP test</strong>
            <span>Metaframer çalışma alanı</span>
          </div>
        </div>
        <p className="nav-label">ÇALIŞMA ALANI</p>
        <nav>
          <NavLink to="/products">
            <Package size={19} />
            <span>Ürünler</span>
            <ChevronRight size={15} className="nav-chevron" />
          </NavLink>
          <NavLink to="/apps">
            <LayoutGrid size={19} />
            <span>Uygulamalar</span>
            <ChevronRight size={15} className="nav-chevron" />
          </NavLink>
        </nav>
        <div className="sidebar-note">
          <div className="sidebar-note-icon">
            <Boxes size={22} />
          </div>
          <strong>ERPNext ile aynı veri</strong>
          <p>
            Kaydettiğiniz değişiklikler ERPNext’e yansır. Katalog, yeni istekte
            güncel bilgiyi alır.
          </p>
        </div>
        <div className="sidebar-user">
          <div className="avatar">
            {auth.session.user.slice(0, 1).toLocaleUpperCase("tr")}
          </div>
          <div className="user-copy">
            <strong title={auth.session.user}>{auth.session.user}</strong>
            <span>ERPNext hesabı</span>
          </div>
          <button
            className="icon-button logout-button"
            aria-label="Çıkış yap"
            title="Çıkış yap"
            disabled={logoutBusy}
            onClick={logout}
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              ref={menu}
              className="icon-button mobile-menu"
              onClick={() => setDrawer(true)}
              aria-label="Menüyü aç"
              aria-expanded={drawer}
            >
              <Menu size={22} />
            </button>
            <span className="breadcrumb-workspace">Çalışma alanı</span>
            <ChevronRight size={14} className="breadcrumb-workspace" />
            <span>{section}</span>
          </div>
          <div className="topbar-links">
            <a
              href={
                import.meta.env.VITE_STOREFRONT_URL ||
                "https://metafrappe.github.io/metaframer-storefront/"
              }
              target="_blank"
              rel="noopener noreferrer"
              className="backend-link"
            >
              Vitrini aç
              <ArrowUpRight size={16} />
              <span className="sr-only"> (yeni sekmede)</span>
            </a>
            <a
              href="https://erp-test.metaframer.net/desk"
              target="_blank"
              rel="noopener noreferrer"
              className="backend-link"
            >
              ERPNext’i aç
              <ArrowUpRight size={16} />
              <span className="sr-only"> (yeni sekmede)</span>
            </a>
          </div>
        </header>
        <main id="main" className="main-content">
          {logoutError && <ErrorPanel compact message={logoutError} />}
          <Outlet />
        </main>
        <footer className="workspace-footer">
          <span>Metaframer Workspace</span>
          <span>Veri kaynağı: erp-test.metaframer.net</span>
        </footer>
      </div>
    </div>
  );
}

type AppModule = {
  id: string;
  name: string;
  url: string;
  mode: "native" | "headless";
};
function AppsPage() {
  const [apps, setApps] = useState<AppModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<{ data: AppModule[] }>("/apps", { signal: controller.signal })
      .then((result) => setApps(result.data))
      .catch((err) => {
        if (!isAborted(err)) setError(errorMessage(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [attempt]);
  return (
    <>
      <PageHeader
        eyebrow="ÇALIŞMA ALANI"
        title="Uygulamalar"
        description="Kurulu araçlarınıza tek noktadan ulaşın."
      />
      <section className="module-hero">
        <div className="module-hero-icon">
          <Package size={32} strokeWidth={1.5} />
        </div>
        <div>
          <span className="pill">Bu arayüzde</span>
          <h2>Ürün yönetimi</h2>
          <p>Ürünleri listeleyin, düzenleyin ve varyantlarını inceleyin.</p>
        </div>
        <Link to="/products" className="button primary">
          Ürünlere git
          <ArrowRight size={17} />
        </Link>
      </section>
      <div className="section-heading">
        <div>
          <h2>ERPNext uygulamaları</h2>
          <p>
            Bu bağlantılar mevcut Frappe ekranlarını yeni sekmede açar. Özel
            arayüz bu aşamada ürün yönetimi için hazırdır.
          </p>
        </div>
        {!loading && !error && (
          <span className="count-pill">{apps.length} uygulama</span>
        )}
      </div>
      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorPanel message={error} retry={() => setAttempt((x) => x + 1)} />
      ) : !apps.length ? (
        <EmptyState
          title="Uygulama bulunamadı"
          description="Sunucu bu çalışma alanı için uygulama bağlantısı döndürmedi."
        />
      ) : (
        <div className="module-grid">
          {apps.map((app, index) => (
            <a
              className="module-card"
              key={app.id}
              href={app.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className={`module-icon color-${index % 4}`}>
                <LayoutGrid size={22} strokeWidth={1.5} />
              </span>
              <div>
                <h3>{app.name}</h3>
                <span>
                  {app.mode === "headless"
                    ? "Yönetim arayüzü"
                    : "Frappe ekranı"}
                </span>
              </div>
              <ArrowUpRight size={19} />
              <span className="sr-only"> Yeni sekmede açılır.</span>
            </a>
          ))}
        </div>
      )}
    </>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Workspace />}>
        <Route index element={<Navigate to="/products" replace />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/products/new" element={<ProductFormPage />} />
        <Route path="/products/:id" element={<ProductDetailPage />} />
        <Route path="/products/:id/edit" element={<ProductFormPage />} />
        <Route path="/apps" element={<AppsPage />} />
        <Route path="/setup" element={<LocalSetupPage />} />
        <Route
          path="*"
          element={
            <EmptyState
              title="Sayfa bulunamadı"
              description="Bağlantıyı kontrol edin veya ürünlerinize dönün."
            >
              <Link className="button primary" to="/products">
                Ürünlere dön
              </Link>
            </EmptyState>
          }
        />
      </Route>
    </Routes>
  );
}
