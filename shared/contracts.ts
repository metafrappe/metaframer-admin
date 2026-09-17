export interface Product {
  id: string;
  code: string;
  name: string;
  description: string;
  group: string;
  uom: string;
  image: string | null;
  disabled: boolean;
  isStockItem: boolean;
  hasVariants: boolean;
  variantOf: string | null;
  attributes: { name: string; value: string }[];
  modified: string;
}
export interface ProductInput {
  code: string;
  name: string;
  description: string;
  group: string;
  uom: string;
  image: string | null;
  disabled: boolean;
  isStockItem: boolean;
}
export interface ProductList {
  data: Product[];
  meta: { page: number; pageSize: number; hasMore: boolean; source: "frappe" };
}
export interface ProductDetail {
  data: { product: Product; variants: Product[] };
  meta: {
    source: "frappe";
    variants?: { page: number; pageSize: number; hasMore: boolean };
  };
}
export interface Session {
  user: string;
  csrfToken: string;
}
export interface ProductOptions {
  itemGroups: string[];
  uoms: string[];
  publicGroup: string;
}
export interface ApiProblem {
  type: string;
  title: string;
  status: number;
  detail: string;
  requestId: string;
}
