/**
 * @krallik/shared — oyun kurallarının tek kaynağı.
 *
 * Backend bu kuralları uygular, tick servisi bu formülleri çalıştırır, LLM
 * bağlam paketi bu tablolardan özetlenir ve frontend aynı tiplerle çizer.
 * Kuralın tek bir yerde yaşaması, GDD §15.5'teki "LLM çıktısı öneridir, asla
 * komut değildir" ilkesinin uygulanabilir olmasının ön koşulu.
 */

export * from './types.js';
export * from './balance.js';
export * from './buildings.js';
export * from './units.js';
export * from './terrain.js';
export * from './formulas.js';
export * from './tools.js';
export * from './api.js';
