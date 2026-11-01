import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { bandOf, resolveRoll, previewRoll, normalizeLevers, dvOf, DV_LADDER } from '../scripts/engine/rolls.js';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';
import { installFakeChat } from './helpers/fakeChat.mjs';

const plain = (total) => ({ total, crit: null });

test('bands follow the margin; a fumble only when it fails, a critical always exceptional', () => {
  assert.deepEqual([-1, 0, 1, 2, 5, 6, 7, 8].map((m) => bandOf(m)),
    ['failure', 'narrow', 'narrow', 'solid', 'solid', 'strong', 'strong', 'exceptional']);
  assert.equal(bandOf(-2, 'fumble'), 'fumble');
  assert.equal(bandOf(0, 'fumble'), 'narrow');
  assert.equal(bandOf(0, 'success'), 'exceptional');
});

test('the approach moves the DV and scales the effect', () => {
  const standard = resolveRoll({ base: 10, roll: plain(5), dv: 13 });
  assert.deepEqual([standard.dv, standard.margin, standard.band, standard.effect], [13, 2, 'solid', 1]);
  const careful = resolveRoll({ base: 10, roll: plain(5), dv: 13, levers: { approach: 'careful' } });
  assert.deepEqual([careful.dv, careful.band, careful.effect], [11, 'solid', 0.75]);
  const bold = resolveRoll({ base: 10, roll: plain(5), dv: 13, levers: { approach: 'bold' } });
  assert.deepEqual([bold.dv, bold.band, bold.effect, bold.exposure], [16, 'failure', 0, 1]);
});

test('Luck and the complementary bonus add to the total', () => {
  const r = resolveRoll({ base: 10, roll: plain(3), dv: 15, levers: { luck: 2, bonus: 1 } });
  assert.deepEqual([r.total, r.luck, r.bonus, r.band], [16, 2, 1, 'narrow']);
});

test('levers are cleaned up: a hire takes no Luck, unknown values fall back', () => {
  assert.deepEqual(normalizeLevers({ approach: 'reckless', luck: 3.7, bonus: 5, hire: 'good' }), { approach: 'standard', luck: 0, bonus: 1, extra: 0, hire: 'good' });
  assert.deepEqual(normalizeLevers({ luck: -2, hire: 'nobody' }), { approach: 'standard', luck: 0, bonus: 0, extra: 0, hire: null });
  assert.equal(normalizeLevers({ luck: 40 }).luck, 10);
});

test('a DV is named by its ladder step or given as a number', () => {
  assert.equal(dvOf('professional'), DV_LADDER.professional);
  assert.equal(dvOf(16), 16);
  assert.equal(dvOf('nonsense'), DV_LADDER.everyday);
});

test('the preview gives exact chances over the CPR d10', () => {
  const p = previewRoll({ base: 10, dv: 15 });
  assert.equal(p.needed, 5);
  // Passes on 5..9 (50%), and on any 10 (10%); a 1 always fails here.
  assert.equal(p.chance, 0.6);
  const sum = p.bands.reduce((a, b) => a + b.chance, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.equal(p.bands.find((b) => b.band === 'fumble').chance, 0.1);
  assert.ok(previewRoll({ base: 10, dv: 15, levers: { approach: 'careful' } }).chance > p.chance);
});

// ── The player's roll and the GM's check ──────────────────────────────────────

const env = installFakeFoundry({ actors: [['Medtech', 1000, true], ['Fixer', 1000, true]] });
const [medtech, fixer] = env.actors;
medtech.system.stats = { tech: { value: 7 }, luck: { value: 5, max: 5 } };
medtech.items = [{ type: 'skill', name: 'Cybertech', system: { level: 5, stat: 'tech' } }];
fixer.system.stats = { cool: { value: 6 }, luck: { value: 4, max: 4 } };
fixer.items = [{ type: 'role', name: 'Fixer', system: { rank: 4, mainRoleAbility: 'Operator' } }];
for (const actor of [medtech, fixer]) {
  actor.update = async (d) => {
    if ('system.stats.luck.value' in d) actor.system.stats.luck.value = d['system.stats.luck.value'];
  };
}
const fake = installFakeChat();
game.i18n.format = (k) => k;

let SkillAdapter;
let dice = [];
before(async () => {
  SkillAdapter = (await import('../scripts/services/SkillAdapter.js')).SkillAdapter;
  SkillAdapter.rollOne = async () => ({ value: dice.shift() ?? 5, roll: null });
});

const cybertech = { kind: 'skill', skill: 'Cybertech', stat: 'tech' };
const request = (rollId) => ({ key: `k${Math.random()}`, rollId, ts: Date.now() });

test('Luck is spent from the sheet when the player rolls, and the GM counts it', async () => {
  dice = [4];
  const { result, messageId } = await SkillAdapter.leverCheck(medtech, { dv: 15, title: 'Work the shop', use: cybertech, levers: { luck: 2, approach: 'bold' } });
  assert.equal(medtech.system.stats.luck.value, 3);
  assert.deepEqual([result.total, result.dv, result.band], [18, 18, 'narrow']);

  const out = await SkillAdapter.verifyLevers(medtech, request(messageId), { dv: 15, use: cybertech });
  assert.equal(out.ok, true);
  assert.deepEqual([out.levers.luck, out.levers.approach, out.result.total, out.result.band], [2, 'bold', 18, 'narrow']);
});

test('Luck the pool did not lose is not counted', async () => {
  dice = [4];
  medtech.system.stats.luck.value = 5;
  const { messageId } = await SkillAdapter.leverCheck(medtech, { dv: 15, title: 'Work', use: cybertech, levers: { luck: 2 } });
  medtech.system.stats.luck.value = 5; // put back, as an edited sheet would
  const out = await SkillAdapter.verifyLevers(medtech, request(messageId), { dv: 15, use: cybertech });
  assert.equal(out.levers.luck, 0);
  assert.equal(out.result.total, 16);
});

test('a bonus counts only when the business has one waiting', async () => {
  dice = [4];
  const { messageId } = await SkillAdapter.leverCheck(medtech, { dv: 15, title: 'Work', use: cybertech, levers: { bonus: 1 } });
  const without = await SkillAdapter.verifyLevers(medtech, request(messageId), { dv: 15, use: cybertech });
  assert.equal(without.levers.bonus, 0);
  dice = [4];
  const again = await SkillAdapter.leverCheck(medtech, { dv: 15, title: 'Work', use: cybertech, levers: { bonus: 1 } });
  const withBonus = await SkillAdapter.verifyLevers(medtech, request(again.messageId), { dv: 15, use: cybertech, bonusAvailable: true });
  assert.equal(withBonus.levers.bonus, 1);
});

test('a role ability in a business roll adds its rank plus the bonus staff get; a plain one, or the bare rank, does not', async () => {
  dice = [6];
  const use = { kind: 'ability', ability: 'Operator' };
  const { result, messageId } = await SkillAdapter.leverCheck(fixer, { dv: 13, title: 'Find the space', use });
  assert.equal(result.total, 19, 'rank 4 + 9 + 6');
  const out = await SkillAdapter.verifyLevers(fixer, request(messageId), { dv: 13, use });
  assert.deepEqual([out.ok, out.base, out.result.total], [true, 13, 19]);

  dice = [6];
  const plain = { ...use, plain: true };
  const bare = await SkillAdapter.leverCheck(fixer, { dv: 13, title: 'The ability itself', use: plain });
  assert.equal(bare.result.total, 10, 'rank 4 + 6');

  assert.equal(SkillAdapter.baseFor(fixer, use).base, 4, 'staff bases and team sizes read the bare rank');
  assert.equal(SkillAdapter.rollBase(fixer, { kind: 'ability', ability: 'Teamwork' }).base, 0, 'an ability they lack adds nothing');
});

test('a hired professional replaces stat and skill, takes no Luck, and only where allowed', async () => {
  dice = [5];
  const use = { kind: 'hire', hire: 'good' };
  const before = fixer.system.stats.luck.value;
  const { result, messageId } = await SkillAdapter.leverCheck(fixer, { dv: 15, title: 'Accounts', use, levers: { luck: 3 } });
  assert.equal(fixer.system.stats.luck.value, before, 'no Luck spent');
  assert.equal(result.total, 18);
  assert.equal((await SkillAdapter.verifyLevers(fixer, request(messageId), { dv: 15, use })).reason, 'hire-not-allowed');
  const ok = await SkillAdapter.verifyLevers(fixer, request(messageId), { dv: 15, use, allowHire: true });
  assert.deepEqual([ok.ok, ok.result.total], [true, 18]);
});

test('a card for one skill does not verify as another', async () => {
  dice = [5];
  const { messageId } = await SkillAdapter.leverCheck(medtech, { dv: 13, title: 'Work', use: cybertech });
  const out = await SkillAdapter.verifyLevers(medtech, request(messageId), { dv: 13, use: { kind: 'skill', skill: 'Paramedic', stat: 'tech' } });
  assert.equal(out.reason, 'roll-mismatch');
  assert.ok(fake.messages.size > 0);
});

test('a skill the sheet qualifies, such as Local Expert (Your Home), counts at its best level', () => {
  const sheet = {
    system: { stats: { int: { value: 6 } } },
    items: [
      { type: 'skill', name: 'Local Expert (Your Home)', system: { level: 2, stat: 'int' } },
      { type: 'skill', name: 'Local Expert (Old Corp Center)', system: { level: 5, stat: 'int' } },
      { type: 'skill', name: 'Library Search', system: { level: 3, stat: 'int' } },
    ],
  };
  assert.deepEqual([SkillAdapter.read(sheet, 'Local Expert', 'int').level, SkillAdapter.read(sheet, 'Local Expert', 'int').total], [5, 11]);
  assert.equal(SkillAdapter.read(sheet, 'Library Search', 'int').level, 3, 'an exact name is still read as it is');
  assert.equal(SkillAdapter.read(sheet, 'Local', 'int').found, false, 'only the whole skill name before the qualifier matches');
});
