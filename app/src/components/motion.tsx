// Motion helpers built on `motion` (framer): page transitions, tap feedback
// and the flying-coin reward animation. All respect reduced-motion.
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';
import { Coin } from './ui';

/** Fade/slide the new screen in. No exit animation: two screens must never
 *  be in the DOM at once (it confuses both users and selectors). */
export function PageTransition({ id, children }: { id: string; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      key={id}
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

export function Pressable({ className = '', children, ...rest }: { className?: string; children: ReactNode; onClick?: () => void }) {
  return (
    <motion.button type="button" whileTap={{ scale: 0.96 }} className={className} {...rest}>
      {children}
    </motion.button>
  );
}

/** Coins arc from the centre of the screen to `target` (viewport coords), then fade. */
export function FlyingCoins({
  count = 10,
  target,
  onDone,
}: {
  count?: number;
  target: { x: number; y: number } | null;
  onDone?: () => void;
}) {
  const reduce = useReducedMotion();
  const [coins] = useState(() =>
    Array.from({ length: count }, (_, i) => ({
      id: i,
      dx: (Math.random() - 0.5) * 160,
      dy: -40 - Math.random() * 120,
      delay: i * 0.05,
    })),
  );
  useEffect(() => {
    const t = window.setTimeout(() => onDone?.(), reduce ? 50 : 1300 + count * 50);
    return () => window.clearTimeout(t);
  }, [onDone, reduce, count]);
  if (reduce || !target) return null;
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  return (
    <div className="pointer-events-none fixed inset-0 z-50" aria-hidden="true">
      {coins.map((c) => (
        <motion.div
          key={c.id}
          className="absolute"
          style={{ left: cx, top: cy }}
          initial={{ x: 0, y: 0, opacity: 0, scale: 0.6 }}
          animate={{
            x: [0, c.dx, target.x - cx],
            y: [0, c.dy, target.y - cy],
            opacity: [0, 1, 1, 0],
            scale: [0.6, 1.1, 0.7],
          }}
          transition={{ duration: 1.1, delay: c.delay, ease: 'easeInOut', times: [0, 0.45, 1] }}
        >
          <Coin size={22} />
        </motion.div>
      ))}
    </div>
  );
}
