// Coin shop: power-ups, outfits for Chikki, accent themes.
import { Check, Snowflake } from 'lucide-react';
import { useApp, useStreakStanding } from '../store';
import { Button, Card, Coin } from '../components/ui';
import { Mascot, type MascotOutfit } from '../components/Mascot';
import { SHOP, type Sku } from '../engine/coins';
import { MAX_FREEZES } from '../engine/streak';

const ACCENT_SWATCH: Record<string, string> = {
  lotus: 'linear-gradient(135deg,#e2578a,#ffd1e1)',
  peacock: 'linear-gradient(135deg,#1f8a9e,#9fe3ee)',
  mango: 'linear-gradient(135deg,#ff8a2a,#ffe3b0)',
};

function Price({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-1 font-extrabold">
      <Coin size={14} /> {n}
    </span>
  );
}

function Item({ sku }: { sku: Sku }) {
  const coins = useApp((s) => s.coins);
  const owned = useApp((s) => s.ownedSkus);
  const profile = useApp((s) => s.profile);
  const streak = useApp((s) => s.streak);
  const spend = useApp((s) => s.spendCoins);
  const equip = useApp((s) => s.equip);
  const have = owned.has(sku.id);
  const equipped = sku.kind === 'outfit' ? profile?.outfit === sku.id : sku.kind === 'accent' ? profile?.accent === sku.id : false;
  const freezeFull = sku.id === 'freeze' && streak.freezesOwned >= MAX_FREEZES;
  // a freeze protects days ahead; it cannot bring back a streak that already ended
  const { standing } = useStreakStanding();
  const freezeTooLate = sku.id === 'freeze' && standing === 'broken';
  const canAfford = coins >= sku.price;

  let action: React.ReactNode;
  if (sku.consumable) {
    action = (
      <Button variant="primary" className="px-3 py-2 text-sm" disabled={!canAfford || freezeFull || freezeTooLate} onClick={() => void spend(sku.id)}>
        {freezeFull ? 'Max held' : <Price n={sku.price} />}
      </Button>
    );
  } else if (!have) {
    action = (
      <Button variant="primary" className="px-3 py-2 text-sm" disabled={!canAfford} onClick={() => void spend(sku.id)}>
        <Price n={sku.price} />
      </Button>
    );
  } else {
    action = (
      <Button
        variant={equipped ? 'ghost' : 'secondary'}
        className="px-3 py-2 text-sm"
        onClick={() => void equip(sku.kind as 'outfit' | 'accent', equipped ? null : sku.id)}
      >
        {equipped ? (
          <span className="inline-flex items-center gap-1">
            <Check size={16} /> Equipped
          </span>
        ) : (
          'Equip'
        )}
      </Button>
    );
  }

  return (
    <Card className="flex items-center gap-4 p-4">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-accent-soft">
        {sku.kind === 'outfit' && <Mascot size={62} outfit={sku.id as MascotOutfit} />}
        {sku.kind === 'accent' && <span className="h-11 w-11 rounded-full shadow-soft" style={{ background: ACCENT_SWATCH[sku.id] }} />}
        {sku.kind === 'powerup' && <Snowflake size={30} className="text-teal" />}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="font-extrabold">{sku.name}</h3>
        <p className="text-sm font-semibold text-ink-soft">{sku.blurb}</p>
        {sku.id === 'freeze' && (
          <p className="mt-0.5 text-xs font-bold text-teal">
            Holding {streak.freezesOwned}/{MAX_FREEZES}
          </p>
        )}
        {freezeTooLate && (
          <p className="mt-0.5 text-xs font-bold text-error" role="status" data-testid="freeze-too-late">
            Your streak has already ended, and a freeze can't bring it back. Do a lesson to start a new streak, then a freeze can protect it.
          </p>
        )}
      </div>
      {action}
    </Card>
  );
}

export function Shop() {
  const coins = useApp((s) => s.coins);
  const groups: { kind: Sku['kind']; title: string; blurb: string }[] = [
    { kind: 'powerup', title: 'Power-ups', blurb: 'Keep your streak safe.' },
    { kind: 'outfit', title: 'Outfits for Chikki', blurb: 'Dress up your parrot.' },
    { kind: 'accent', title: 'Themes', blurb: 'Change the colour of the whole app.' },
  ];
  return (
    <div className="flex flex-col gap-6">
      <div className="surface-hero flex items-center justify-between p-5">
        <div>
          <h1 className="text-2xl font-extrabold">Shop</h1>
          <p className="text-sm font-semibold text-ink-soft">Earn coins by finishing lessons and quests.</p>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-card/80 px-4 py-2 text-xl font-extrabold shadow-soft">
          <Coin size={22} /> <span data-testid="shop-balance">{coins}</span>
        </div>
      </div>
      {groups.map((g) => (
        <section key={g.kind} className="flex flex-col gap-3">
          <div>
            <h2 className="text-lg font-extrabold">{g.title}</h2>
            <p className="text-sm font-semibold text-ink-soft">{g.blurb}</p>
          </div>
          {SHOP.filter((s) => s.kind === g.kind).map((s) => (
            <Item key={s.id} sku={s} />
          ))}
        </section>
      ))}
    </div>
  );
}
