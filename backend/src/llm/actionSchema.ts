import { z } from "zod";
import type { GameAction } from "../models/types.js";

/**
 * The complete, closed vocabulary the LLM is allowed to act through. These are
 * exposed to the model as OpenAI function/tool definitions - the model can
 * never affect game state through free text, only through one of these four
 * structured calls, and every call is re-validated by the rule engine
 * (src/rules/ruleEngine.ts) before anything is applied.
 */

const RESOURCE_ENUM = ["gold", "wood", "food", "stone", "iron"] as const;
const STRUCTURE_ENUM = ["base", "farm", "sawmill", "barracks", "market", "mine"] as const;

export const attackArgsSchema = z.object({
  unit_id: z.string().min(1),
  target_unit_id: z.string().min(1),
});

export const tradeArgsSchema = z.object({
  offer_resource: z.enum(RESOURCE_ENUM),
  offer_amount: z.number().int().positive(),
  request_resource: z.enum(RESOURCE_ENUM),
  request_amount: z.number().int().positive(),
  target_player_id: z.string().min(1),
});

export const buildArgsSchema = z.object({
  structure_type: z.enum(STRUCTURE_ENUM),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
});

export const recruitArgsSchema = z.object({
  structure_id: z.string().min(1),
});

export const OPENAI_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "attack",
      description: "Kendi biriminizle bir dusman birime saldirin.",
      parameters: {
        type: "object",
        properties: {
          unit_id: { type: "string", description: "Saldiran kendi biriminizin id'si." },
          target_unit_id: { type: "string", description: "Saldirilacak dusman birimin id'si." },
        },
        required: ["unit_id", "target_unit_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "trade",
      description: "Baska bir oyuncuya kaynak ticareti teklifi yapin.",
      parameters: {
        type: "object",
        properties: {
          offer_resource: { type: "string", enum: RESOURCE_ENUM },
          offer_amount: { type: "number" },
          request_resource: { type: "string", enum: RESOURCE_ENUM },
          request_amount: { type: "number" },
          target_player_id: { type: "string" },
        },
        required: [
          "offer_resource",
          "offer_amount",
          "request_resource",
          "request_amount",
          "target_player_id",
        ],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "build",
      description:
        "Kendi bolgenizde yeni bir yapi insa edin. 'mine' sadece bilinen bir maden yatagi " +
        "(dag karosu) uzerine kurulabilir ve o kaynaktan otomatik uretim baslatir.",
      parameters: {
        type: "object",
        properties: {
          structure_type: { type: "string", enum: STRUCTURE_ENUM },
          x: { type: "number" },
          y: { type: "number" },
        },
        required: ["structure_type", "x", "y"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "recruit",
      description: "Sahip oldugunuz bir kislada altin ve yiyecek harcayarak yeni bir asker egitin.",
      parameters: {
        type: "object",
        properties: {
          structure_id: { type: "string", description: "Askerin egitilecegi kendi kislanizin id'si." },
        },
        required: ["structure_id"],
      },
    },
  },
];

export interface ToolCall {
  name: string;
  arguments: string;
}

export interface ParsedAction {
  action: GameAction | null;
  error: string | null;
}

/** Parses one raw OpenAI tool call into a validated GameAction. Never throws -
 * a malformed call just becomes a rejected action with a reason, same as any
 * other invalid action would be at the rule-engine stage. */
export function parseToolCall(call: ToolCall): ParsedAction {
  let raw: unknown;
  try {
    raw = JSON.parse(call.arguments);
  } catch {
    return { action: null, error: `Gecersiz JSON argumanlari: ${call.arguments}` };
  }

  switch (call.name) {
    case "attack": {
      const parsed = attackArgsSchema.safeParse(raw);
      if (!parsed.success) return { action: null, error: parsed.error.message };
      return {
        action: {
          type: "attack",
          unitId: parsed.data.unit_id,
          targetUnitId: parsed.data.target_unit_id,
        },
        error: null,
      };
    }
    case "trade": {
      const parsed = tradeArgsSchema.safeParse(raw);
      if (!parsed.success) return { action: null, error: parsed.error.message };
      return {
        action: {
          type: "trade",
          offerResource: parsed.data.offer_resource,
          offerAmount: parsed.data.offer_amount,
          requestResource: parsed.data.request_resource,
          requestAmount: parsed.data.request_amount,
          targetPlayerId: parsed.data.target_player_id,
        },
        error: null,
      };
    }
    case "build": {
      const parsed = buildArgsSchema.safeParse(raw);
      if (!parsed.success) return { action: null, error: parsed.error.message };
      return {
        action: {
          type: "build",
          structureType: parsed.data.structure_type,
          x: parsed.data.x,
          y: parsed.data.y,
        },
        error: null,
      };
    }
    case "recruit": {
      const parsed = recruitArgsSchema.safeParse(raw);
      if (!parsed.success) return { action: null, error: parsed.error.message };
      return {
        action: { type: "recruit", structureId: parsed.data.structure_id },
        error: null,
      };
    }
    default:
      return { action: null, error: `Bilinmeyen fonksiyon cagrisi: ${call.name}` };
  }
}
