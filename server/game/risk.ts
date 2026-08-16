export type RiskTier="routine"|"major"|"catastrophic";
export function classifyRisk(tool:string,args:Record<string,unknown>,snapshot:{treasury:number;armyTotal:number}) : RiskTier {
  if(tool==="move_army"&&args.intent==="attack")return Number(args.shareOfArmy??0)>.75?"catastrophic":"major";
  if(["send_diplomacy_message","propose_troop_rental"].includes(tool))return "major";
  if(Number(args.goldCost??0)>snapshot.treasury*.35)return "major";
  return "routine";
}
export function loyaltyEffect(tier:RiskTier,confirmed:boolean){if(tier==="catastrophic")return confirmed?-8:-1;if(tier==="major")return confirmed?-1:1;return .2;}
