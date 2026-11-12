// Settings card: choose between the forest map and the classic path.
// Device-local (see pathStyle.ts). Renders nothing when the master flag is off.

import { Button, Card } from '../../components/ui';
import { FOREST_MAP_ENABLED, setPathStyle, usePathStyle, type PathStyle } from './pathStyle';

const OPTIONS: [PathStyle, string][] = [
  ['forest', 'Forest map'],
  ['classic', 'Classic'],
];

export function PathStyleSetting() {
  const style = usePathStyle();
  if (!FOREST_MAP_ENABLED) return null;
  return (
    <Card data-testid="path-style-setting">
      <h3 className="mb-1 font-extrabold">Path style</h3>
      <p className="mb-3 text-sm font-semibold text-ink-soft">How the lesson path looks on this device.</p>
      <div className="flex gap-2">
        {OPTIONS.map(([value, label]) => (
          <Button
            key={value}
            variant={style === value ? 'secondary' : 'ghost'}
            aria-pressed={style === value}
            className="flex-1 px-2 text-sm normal-case tracking-normal"
            onClick={() => setPathStyle(value)}
          >
            {label}
          </Button>
        ))}
      </div>
    </Card>
  );
}
