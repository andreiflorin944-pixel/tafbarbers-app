import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '@/api';
import type { Product } from '@/data/types';

// Coșul de cumpărături. Ține doar id-uri și cantități; prețurile vin mereu din lista de produse.
type Cart = {
  products: Product[];
  reloadProducts: () => void;
  qty: (id: string) => number;
  setQty: (id: string, qty: number) => void;
  lines: Array<{ product: Product; qty: number }>;
  count: number;
  total: number;
  clear: () => void;
};

const Ctx = createContext<Cart | null>(null);
const MAX_QTY = 10;

export function CartProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [items, setItems] = useState<Record<string, number>>({});
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    api.getProducts().then(setProducts, () => setProducts([]));
  }, [attempt]);

  const setQty = useCallback(
    (id: string, q: number) =>
      setItems((cur) => {
        const p = products.find((x) => x.id === id);
        const max = Math.min(MAX_QTY, p?.stock ?? MAX_QTY);
        const next = { ...cur };
        const v = Math.max(0, Math.min(max, Math.floor(q)));
        if (v) next[id] = v;
        else delete next[id];
        return next;
      }),
    [products],
  );

  const value = useMemo<Cart>(() => {
    // Produsele dispărute din magazin ies singure din coș.
    const lines = Object.entries(items)
      .map(([id, qty]) => ({ product: products.find((p) => p.id === id)!, qty }))
      .filter((l) => l.product);
    return {
      products,
      reloadProducts: () => setAttempt((a) => a + 1),
      qty: (id) => items[id] ?? 0,
      setQty,
      lines,
      count: lines.reduce((s, l) => s + l.qty, 0),
      total: lines.reduce((s, l) => s + l.qty * l.product.price, 0),
      clear: () => setItems({}),
    };
  }, [products, items, setQty]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCart must be used inside CartProvider');
  return ctx;
}
