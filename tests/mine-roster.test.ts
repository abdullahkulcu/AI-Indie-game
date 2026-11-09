import assert from "node:assert/strict";
import test from "node:test";
import { isCurrentMineCrew } from "../server/mine-roster";

test("eski channel'da kalan maden işçisi yuva tutmaz", () => {
  const game = { channelId: "new-channel" };
  assert.equal(isCurrentMineCrew({ activeMembership: false, mineChannelId: "old-channel", game }), false);
  assert.equal(isCurrentMineCrew({ activeMembership: true, mineChannelId: "old-channel", game }), false);
});

test("eski kayıtta channel kimliği yoksa etkin üyelik yeterlidir", () => {
  const game = {};
  assert.equal(isCurrentMineCrew({ activeMembership: true, mineChannelId: "channel", game }), true);
});
