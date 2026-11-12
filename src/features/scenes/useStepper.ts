import { useState } from 'react';

export function useStepper(count: number) {
  const [index, setIndex] = useState(0);
  return {
    index: Math.min(index, Math.max(0, count - 1)),
    next: () => setIndex((current) => Math.min(current + 1, Math.max(0, count - 1))),
    prev: () => setIndex((current) => Math.max(0, current - 1)),
  };
}
