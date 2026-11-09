/**
 * HALK OYLAMASI — oy oranı tek başına oyunun ölçtüğü toplumsal durumdan doğar.
 *
 * Halk-AI yalnızca sonucu insanî bir dille açıklar. Böylece model, oylamanın
 * yüzdesini veya politika sonucunu değiştiremez; General de halkın yerine oy
 * kullanamaz. Bir oyun haftası dolmadan ikinci kez sorulamaz.
 */
export const REFERENDUM_TOPICS = ["tax_increase", "tax_relief", "food_cut", "food_relief"] as const;
export type ReferendumTopic = typeof REFERENDUM_TOPICS[number];
export type ReferendumVerdict = "supported" | "divided" | "opposed";

export const REFERENDUM_GAME_HOURS = 7 * 24;

export function referendumCooldownMs(speed: number) {
  return REFERENDUM_GAME_HOURS * 3_600_000 / Math.max(1, Number(speed) || 1);
}

export function isReferendumTopic(value: unknown): value is ReferendumTopic {
  return (REFERENDUM_TOPICS as readonly string[]).includes(String(value));
}

export function referendumQuestion(topic: ReferendumTopic) {
  if (topic === "tax_increase") return "Vergiyi artırmalı mıyız?";
  if (topic === "tax_relief") return "Vergiyi hafifletmeli miyiz?";
  if (topic === "food_cut") return "Yiyecek istihkakını azaltmalı mıyız?";
  return "Yiyecek istihkakını artırmalı mıyız?";
}

export function referendumSupport(input: { topic: ReferendumTopic; popularity: number; factionPressure?: number; taxRate: number; foodRation?: number }) {
  const popularity = Math.max(0, Math.min(100, Number(input.popularity) || 0));
  const pressure = Math.max(0, Math.min(100, Number(input.factionPressure) || 0));
  const tax = Math.max(0, Math.min(50, Number(input.taxRate) || 0));
  const food = Math.max(0, Math.min(200, Number(input.foodRation) || 100));
  // Rıza çoğunluk ağırlığıdır; muhalefet güveni çeker. Politikanın bugünkü
  // düzeyi konuya özel yerel ağırlığı taşır. Sonuç zar veya LLM içermez.
  const trust = popularity * .62 - pressure * .28;
  const policy = input.topic === "tax_increase" ? (50 - tax) * .38
    : input.topic === "tax_relief" ? tax * .72
      : input.topic === "food_cut" ? (100 - food) * .42
        : (100 - food) * .78;
  const sentiment = input.topic === "tax_increase" || input.topic === "food_cut" ? -18 : 8;
  return Math.max(5, Math.min(95, Math.round(50 + trust + policy + sentiment)));
}

export function referendumVerdict(support: number): ReferendumVerdict {
  if (support >= 60) return "supported";
  if (support <= 40) return "opposed";
  return "divided";
}
