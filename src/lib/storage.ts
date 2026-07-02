"use client";

import { useEffect, useState } from "react";

export function useStoredCollection<T>(key: string, initialValue: T[]) {
  const [items, setItems] = useState(initialValue);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved) setItems(JSON.parse(saved));
    } catch {
      // ponytail: los datos demo vuelven a su estado inicial si el navegador los corrompe.
    }
  }, [key]);

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(items));
  }, [items, key]);

  return [items, setItems] as const;
}
