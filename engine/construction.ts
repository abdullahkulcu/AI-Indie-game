import type { Key, Res } from "./types";

/**
 * Kraliyet inşaat işleri. Kaynak, iş sıraya GİRDİĞİ anda burada ayrılır;
 * iş başlamak için beklese bile başka harcama tarafından kullanılamaz.
 */
export type ConstructionJob = {
  type: string;
  name: string;
  targetLevel: number;
  reserved: Partial<Res>;
  queuedAt: number;
  /** Başlamamış iş için `null`; bekleme sırası buradan anlaşılır. */
  startedAt: number | null;
  completesAt: number | null;
  durationMs: number;
  hastened?: boolean;
};

/** Kale, aynı anda çalışabilecek şantiye sayısını belirler. */
export function constructionSlots(keepLevel: number) {
  if (keepLevel >= 6) return 4;
  if (keepLevel >= 5) return 3;
  if (keepLevel >= 3) return 2;
  return 1;
}

export function activeConstructionJobs(jobs: readonly ConstructionJob[]) {
  return jobs.filter(job => job.startedAt !== null && job.completesAt !== null);
}

/**
 * Boş şantiyeleri kuyruğun başından doldurur. Sıra değiştirilemez: yalnızca
 * henüz başlamamış işler, kuyruğa girme sıralarıyla başlatılır.
 */
export function startWaitingConstruction(jobs: readonly ConstructionJob[], at: number, keepLevel: number): ConstructionJob[] {
  const slots = constructionSlots(keepLevel);
  let active = activeConstructionJobs(jobs).length;
  return jobs.map(job => {
    if (job.startedAt !== null || active >= slots) return job;
    active += 1;
    return { ...job, startedAt: at, completesAt: at + job.durationMs };
  });
}

/** Ayrılan kaynağı iptalde tam geri vermek için tek yardımcı. */
export function refundReserved(resources: Res, reserved: Partial<Res>): Res {
  const next = { ...resources };
  for (const [key, value] of Object.entries(reserved)) next[key as Key] += value ?? 0;
  return next;
}
