/**
 * SVG sembol sayfası.
 *
 * `#i-wheat`, `#i-keep` … kimlikleri referans arayüzden birebir taşındı; bina
 * tablosundaki `BuildingDef.icon` alanı doğrudan bu kimlikleri veriyor
 * (`buildings.ts`), yani ikon eşlemesi için ayrı bir sözlük tutmuyoruz.
 *
 * Sayfanın kökünde bir kez render edilir; tüm `<use href="#...">` çağrıları
 * buradan beslenir.
 */
export function IconSprite() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <symbol id="i-wheat" viewBox="0 0 24 24">
          <path
            d="M12 4v11M12 4l-3 4M12 4l3 4M9 11l-2 4M15 11l2 4M12 8l-2.5 4M12 8l2.5 4"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            fill="none"
          />
        </symbol>
        <symbol id="i-apple" viewBox="0 0 24 24">
          <circle cx="12" cy="14" r="5" stroke="currentColor" strokeWidth="1.6" fill="none" />
          <path d="M12 9c0-2 1-3 2.5-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
        </symbol>
        <symbol id="i-mill" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="1.4" fill="currentColor" />
          <path
            d="M12 12L12 5M12 12L18 12M12 12L12 19M12 12L6 12"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            fill="none"
          />
        </symbol>
        <symbol id="i-bread" viewBox="0 0 24 24">
          <path
            d="M5 15c0-4 3-7 7-7s7 3 7 7c0 1.5-1 2-3 2H8c-2 0-3-.5-3-2z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
            fill="none"
          />
          <path d="M9 11c1-1 2-1.5 3-1.5s2 .5 3 1.5" stroke="currentColor" strokeWidth="1.1" fill="none" />
        </symbol>
        <symbol id="i-hops" viewBox="0 0 24 24">
          <path d="M7 9h8v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V9z" stroke="currentColor" strokeWidth="1.6" fill="none" />
          <path d="M15 11h2a2 2 0 0 1 0 4h-2" stroke="currentColor" strokeWidth="1.6" fill="none" />
        </symbol>
        <symbol id="i-cheese" viewBox="0 0 24 24">
          <path d="M4 16l8-9 8 9-8 2z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" fill="none" />
          <circle cx="12" cy="14" r="0.8" fill="currentColor" />
          <circle cx="15" cy="15.5" r="0.6" fill="currentColor" />
        </symbol>
        <symbol id="i-quarry" viewBox="0 0 24 24">
          <path
            d="M5 16l2-8 5-3 5 3 2 8-7 3-7-3z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
            fill="none"
          />
        </symbol>
        <symbol id="i-ore" viewBox="0 0 24 24">
          <path d="M12 4l6 6-6 10-6-10z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" fill="none" />
        </symbol>
        <symbol id="i-foundry" viewBox="0 0 24 24">
          <path
            d="M5 14h14v2H5zM9 14v-2h6v2M11 16v3h2v-3"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
            fill="none"
          />
        </symbol>
        <symbol id="i-wood" viewBox="0 0 24 24">
          <rect x="4" y="10" width="16" height="5" rx="2.5" stroke="currentColor" strokeWidth="1.6" fill="none" />
          <circle cx="6.5" cy="12.5" r="1" fill="currentColor" />
          <circle cx="17.5" cy="12.5" r="1" fill="currentColor" />
        </symbol>
        <symbol id="i-market" viewBox="0 0 24 24">
          <path
            d="M12 4v16M6 8h12M6 8l-2 5h4zM18 8l-2 5h4z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </symbol>
        <symbol id="i-granary" viewBox="0 0 24 24">
          <rect x="7" y="5" width="10" height="14" rx="4" stroke="currentColor" strokeWidth="1.6" fill="none" />
          <path d="M7 10h10M7 14h10" stroke="currentColor" strokeWidth="1.1" fill="none" />
        </symbol>
        <symbol id="i-sword" viewBox="0 0 24 24">
          <path
            d="M12 3v13M9 6h6M10 16l2 2 2-2M9 20h6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            fill="none"
          />
        </symbol>
        <symbol id="i-bow" viewBox="0 0 24 24">
          <path d="M9 4c-3 3-3 13 0 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
          <path d="M9 4L9 20" stroke="currentColor" strokeWidth="1" fill="none" />
        </symbol>
        <symbol id="i-horse" viewBox="0 0 24 24">
          <path
            d="M8 19c-2-2-2-9 0-12 1.5-2 3-2.5 4-2.5s2.5.5 4 2.5c2 3 2 10 0 12"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            fill="none"
          />
          <circle cx="8" cy="18" r="0.8" fill="currentColor" />
          <circle cx="16" cy="18" r="0.8" fill="currentColor" />
        </symbol>
        <symbol id="i-siege" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.6" fill="none" />
          <path d="M12 5v14M5 12h14M7.5 7.5l9 9M16.5 7.5l-9 9" stroke="currentColor" strokeWidth="1.1" fill="none" />
        </symbol>
        <symbol id="i-tower" viewBox="0 0 24 24">
          <rect x="7" y="9" width="10" height="11" stroke="currentColor" strokeWidth="1.6" fill="none" />
          <path
            d="M7 9V6h2v2h2V6h2v2h2V6h2v3"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
            fill="none"
          />
        </symbol>
        <symbol id="i-wall" viewBox="0 0 24 24">
          <rect x="4" y="9" width="16" height="10" stroke="currentColor" strokeWidth="1.6" fill="none" />
          <path
            d="M4 13h16M9 9v4M15 9v4M6.5 13v6M12 13v6M17.5 13v6"
            stroke="currentColor"
            strokeWidth="1"
            fill="none"
          />
        </symbol>
        <symbol id="i-keep" viewBox="0 0 24 24">
          <path
            d="M4 18h16M5 18l1-9 3 4 3-6 3 6 3-4 1 9"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
            strokeLinecap="round"
            fill="none"
          />
        </symbol>
        <symbol id="i-banner" viewBox="0 0 24 24">
          <path d="M7 3v18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
          <path d="M7 4l10 3-10 3z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="none" />
        </symbol>
        <symbol id="i-church" viewBox="0 0 24 24">
          <path d="M12 3v2M10 5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" />
          <path d="M7 20V11l5-6 5 6v9z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" fill="none" />
        </symbol>

        {/* --- Referansta satır içi çizilmiş, burada sembolleştirilen ikonlar --- */}
        <symbol id="i-gold" viewBox="0 0 24 24">
          <circle cx="9" cy="15" r="6" stroke="currentColor" strokeWidth="1.6" fill="none" />
          <circle cx="14" cy="9" r="6" stroke="currentColor" strokeWidth="1.6" fill="none" />
        </symbol>
        <symbol id="i-crossed" viewBox="0 0 24 24">
          <path d="M5 5l14 14M19 5L5 19" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
        </symbol>
        <symbol id="i-shield" viewBox="0 0 24 24">
          <path d="M4 14c3-6 13-6 16 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
          <circle cx="12" cy="9" r="2.2" stroke="currentColor" strokeWidth="1.4" fill="none" />
        </symbol>
        <symbol id="i-scroll" viewBox="0 0 24 24">
          <rect x="6" y="4" width="12" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" fill="none" />
          <circle cx="7.5" cy="4.5" r="1.2" fill="currentColor" />
          <circle cx="7.5" cy="19.5" r="1.2" fill="currentColor" />
        </symbol>
        <symbol id="i-star" viewBox="0 0 24 24">
          <path
            d="M12 3l2 4 4 .6-3 3 .7 4.2L12 13l-3.7 1.8L9 10.6l-3-3 4-.6 2-4z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
            fill="none"
          />
        </symbol>
        <symbol id="i-bell" viewBox="0 0 24 24">
          <path
            d="M7 17V11a5 5 0 0 1 10 0v6M5 17h14M10 20h4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            fill="none"
          />
        </symbol>
      </defs>
    </svg>
  );
}
