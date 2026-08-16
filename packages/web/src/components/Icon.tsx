import type { Resource } from '@krallik/shared';

/** `IconSprite` içindeki bir sembolü çizer. `name` başındaki `#` olmadan verilir. */
export function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <use href={`#${name}`} />
    </svg>
  );
}

/**
 * Kaynak → sembol eşlemesi. Referans arayüz Defter'de yiyecek için buğday,
 * demir için cevher ikonunu kullanıyordu; aynı seçimleri koruyoruz.
 */
export const RESOURCE_ICONS: Record<Resource, string> = {
  gold: 'i-gold',
  food: 'i-bread',
  stone: 'i-quarry',
  wood: 'i-wood',
  iron: 'i-foundry',
  ale: 'i-hops',
  wheat: 'i-wheat',
  flour: 'i-mill',
  hops: 'i-hops',
  milk: 'i-cheese',
  ore: 'i-ore',
  weapons: 'i-sword',
  cheese: 'i-cheese',
};
