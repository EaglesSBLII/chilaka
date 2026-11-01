// One-time setup guide for the system Telugu keyboard — required for the
// writing exercises in the Reading & Writing pathway.

import { useState } from 'react';

export function KeyboardHelp({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={compact ? '' : 'rounded-2xl border-2 border-marigold/50 bg-amber-soft px-4 py-3'}>
      <button onClick={() => setOpen((o) => !o)} className="w-full text-left text-sm font-bold text-marigold-dark">
        ⌨️ {open ? 'Hide' : 'Need the Telugu keyboard?'} {open ? '▴' : '▾'}
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2 text-sm font-semibold text-ink">
          <p>
            <span className="font-extrabold">iPhone:</span> Settings → General → Keyboard → Keyboards → Add New
            Keyboard → <span className="te-script font-extrabold">Telugu</span>. While typing, hold the 🌐 globe key
            and pick Telugu.
          </p>
          <p>
            <span className="font-extrabold">Mac:</span> System Settings → Keyboard → Text Input → Input Sources →
            Edit → + → <span className="te-script font-extrabold">Telugu</span>. Switch keyboards with the input menu
            (flag icon in the menu bar) or fn/🌐 key.
          </p>
          <p className="text-ink-soft">
            Tip: the Telugu keyboard works like the letters sound — type the consonant, then the vowel mark.
          </p>
        </div>
      )}
    </div>
  );
}
