import assert from "node:assert/strict";
import test from "node:test";
import {
  blockadeExperienceSteps,
  blockadeFoodSpent,
  blockadeGameHours,
  blockadeHoursCoveredBySupply,
  blockadePressureSteps,
} from "../engine/blockade";
import { rewardBlockadeExperience } from "../engine/units";

const units = { spearman: 20, archer: 10 };

test("abluka erzak maliyeti tur bölünmesinden bağımsızdır", () => {
  const full = blockadeFoodSpent(units, 36);
  const split = blockadeFoodSpent(units, 12)
    + blockadeFoodSpent(units, 36)
    - blockadeFoodSpent(units, 12);
  assert.equal(full, split);
  assert.equal(blockadePressureSteps(0, 36), 3);
  assert.equal(blockadePressureSteps(12, 36), 2);
  assert.equal(blockadeExperienceSteps(0, 48), 2);
  assert.equal(blockadeExperienceSteps(24, 48), 1);
});

test("abluka yalnız taşınabilen erzak kadar baskı üretir", () => {
  const oneHour = blockadeFoodSpent(units, 1);
  const covered = blockadeHoursCoveredBySupply(units, 0, oneHour, 48);
  assert.ok(covered > 0);
  assert.ok(covered < 48);
  assert.ok(blockadeFoodSpent(units, covered) <= oneHour);
  assert.equal(blockadeGameHours(1_000, 3_601_000, 4), 4);
});

test("abluka deneyimi yalnız sınırdaki mevcut birlik türlerine yazılır", () => {
  const experience = rewardBlockadeExperience({ spearman: 3, archer: 0 }, { spearman: 99, archer: 70 }, 4);
  assert.equal(experience.spearman, 100);
  assert.equal(experience.archer, undefined);
});
