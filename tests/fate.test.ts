import assert from "node:assert/strict";
import test from "node:test";
import { fateCueOf, fateSourceKey } from "../engine/fate";
import type { Game } from "../engine/types";

function game(overrides: Partial<Game> = {}) {
  return {
    channelId: "hizli-tac",
    factionPressure: 0,
    foodRation: 100,
    soldierUnrest: 0,
    units: { spearman: 12 },
    ...overrides,
  } as Game;
}

test("Kader yalnız en ağır eşiği tek ikilem olarak açar", () => {
  const cue = fateCueOf(game({ factionPressure: 80, foodRation: 50, soldierUnrest: 70 }));
  assert.equal(cue?.kind, "defiant_opposition");
  assert.match(cue?.discussion ?? "", /seçenekleri/);
});

test("Kader sofra ve kışla kırılmalarını ayrı ayrı tanır", () => {
  assert.equal(fateCueOf(game({ foodRation: 59 }))?.kind, "empty_tables");
  assert.equal(fateCueOf(game({ soldierUnrest: 60 }))?.kind, "garrison_breaking");
  assert.equal(fateCueOf(game({ units: {}, soldierUnrest: 90 })), null);
});

test("Kader kaynak anahtarı aynı channel ve eşikte kalıcıdır", () => {
  const cue = fateCueOf(game({ foodRation: 55 }));
  assert.ok(cue);
  assert.equal(fateSourceKey(game(), cue!), "hizli-tac:empty_tables");
  assert.notEqual(fateSourceKey(game({ channelId: "uzak" }), cue!), "hizli-tac:empty_tables");
});
