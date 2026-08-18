import type { GameAction } from "../engine/types";

/**
 * "Anladım, onayına sunuyorum" yolu.
 *
 * Kral emir kipi kullanmak zorunda değil. General bir istek sezdiğinde eylemi
 * uygulamak yerine propose_action ile somut hale getirip bekletir; Kral kısa
 * bir "onay" dediğinde bekleyen karar yolundan uygulanır.
 *
 * Mantık route.ts içinde gömülü değil, çünkü orası Cloudflare'a özgü modüller
 * import ettiği için testlerden erişilemiyor — kural ile testin ayrı ayrı
 * yazıldığı her yerde ikisi sessizce birbirinden sapıyor.
 */

export type Proposal = { action: GameAction; summary: string };

export type ProposalOutcome = {
  /** propose_action ayıklandıktan sonra kalan, gerçekten uygulanacak eylemler. */
  actions: GameAction[];
  /** Bekleyen karara yazılacak öneri; yoksa null. */
  pending: Proposal | null;
  /** Krala gösterilecek not; öneri yoksa null. */
  note: string | null;
};

export function readProposal(actions: GameAction[], knownTools: readonly string[]): ProposalOutcome {
  const proposal = actions.find(action => action.name === "propose_action");
  if (!proposal) return { actions, pending: null, note: null };

  const rest = actions.filter(action => action.name !== "propose_action");
  const target = String(proposal.arguments?.action ?? "");
  const summary = String(proposal.arguments?.summary ?? "").trim();

  // Model uydurma bir araç adı verebilir; onaya sunulan şey gerçek olmalı.
  if (!summary || !knownTools.includes(target) || target === "propose_action") {
    return {
      actions: rest,
      pending: null,
      note: "⏸ Ne yapmak istediğinizi anladım ama onaya sunacağım somut bir eyleme çeviremedim; biraz daha açar mısınız?",
    };
  }

  return {
    actions: rest,
    pending: { action: { name: target, arguments: (proposal.arguments?.arguments as Record<string, unknown>) ?? {} }, summary },
    note: `⏸ ${summary}\n\nOnaylıyor musunuz? "Onay" demeniz yeterli; vazgeçerseniz "iptal" deyin.`,
  };
}
