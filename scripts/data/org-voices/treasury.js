/**
 * A syndicate treasury's voice (M3 step 5): one dry bookkeeper's voice for every syndicate, with the line changing
 * by context. A motion by what it is about (`money`, `people`, `dissolve`); a vote by how it went (`unanimous`,
 * `close`, or `forced` when the GM settled it). Facts: {syndicate}, {what} (the motion in words), {by} (who
 * tabled it), {date}, {reason}, {units} and {amount}. Greetings and sign-offs name only {syndicate}. English only.
 */

export const TREASURY = Object.freeze({
  treasury: {
    greetings: ['To the members of {syndicate}:', 'Members of {syndicate},', 'From the treasury of {syndicate}.'],
    signoffs: ['The Treasury, {syndicate}', '{syndicate}, Treasury and Records', 'For the treasury of {syndicate}'],
    proposed: {
      money: [
        "{by} proposes to commit the syndicate's money: {what}. The treasury acts only on the members' say-so.",
        "A spending motion from {by}: {what}. The members' funds are at stake, so please vote.",
        'Motion from {by} on the books: {what}. Nothing moves from the account until the members decide.',
      ],
      people: [
        '{by} has put a question of membership to the members: {what}.',
        'A motion on the roll, tabled by {by}: {what}.',
        '{by} asks the members to decide: {what}. The roll changes only if they agree.',
      ],
      dissolve: [
        '{by} moves that {syndicate} be wound up and its cash paid out by units. No graver motion comes before the members.',
        'A motion to dissolve {syndicate} has been tabled by {by}. If carried, the treasury will close the books and pay each member by units.',
      ],
      lines: [
        'A motion is before the members: {what}. It was put forward by {by}.',
        '{by} has tabled a motion: {what}. Your vote is invited.',
        "New motion from {by}: {what}. The treasury awaits the members' decision.",
      ],
    },
    passed: {
      forced: [
        'The motion stands carried without the vote running its course: {what}. The treasury has its instructions.',
        'Carried by order, not by ballot: {what}. It is being carried out.',
      ],
      unanimous: [
        'Carried without a single dissent: {what}.',
        'Every member voted for it: {what}. The treasury will proceed.',
      ],
      close: [
        'Carried, narrowly: {what}. A bare majority of the units said yes.',
        '{what}: passed by the slimmest of margins. The treasury will proceed, and notes that the members were divided.',
      ],
      lines: [
        'Carried: {what}. The treasury will see it done.',
        'Approved by the members: {what}. It is being carried out.',
        'Motion passed: {what}. Members holding more than half the units said yes.',
      ],
    },
    failed: {
      close: [
        'Defeated on a split vote: {what}.',
        'Lost, but only just: {what}. The members are divided on it, and the treasury takes no action.',
      ],
      lines: [
        'Defeated: {what}. Members holding half the units or more voted against.',
        'Turned down by the members: {what}. The treasury will take no action.',
        'Motion lost: {what}. Nothing will be done.',
      ],
    },
    lapsed: {
      lines: [
        'The vote has closed without a majority either way, and the motion has lapsed: {what}.',
        'Lapsed for want of votes: {what}.',
        'Too few members voted before the deadline, and the motion falls: {what}.',
      ],
    },
    vetoed: {
      lines: [
        'Struck out before the vote could finish: {what}.',
        'Withdrawn from the ballot: {what}.',
        'Struck from the order paper, and it will not go ahead: {what}.',
      ],
    },
    void: {
      lines: [
        'The members carried a motion the treasury could not carry out: {what}. The reason: {reason}.',
        'Passed, but impossible: {what}. The reason: {reason}.',
        'Agreed by the members, but it could not be done: {what}. The treasury regrets it. The reason: {reason}.',
      ],
    },
    agreedFailed: {
      lines: [
        'Agreed by the members, but it failed when the treasury tried it: {what}. The reason: {reason}.',
        'An agreed payment or trade has failed: {what}. The reason: {reason}.',
        'The treasury could not complete what the members agreed: {what}. The reason: {reason}.',
      ],
    },
    redeemed: {
      lines: [
        'Your redemption is paid: {units} units of {syndicate} for {amount} eb, now in your brokerage balance.',
        'The treasury has bought back {units} of your units for {amount} eb. The money is in your brokerage balance.',
        'Redemption settled: {units} units, {amount} eb, paid into your brokerage balance.',
      ],
    },
    dissolved: {
      lines: [
        '{syndicate} is wound up. The treasury has paid its cash out to the members by units, and the books are closed.',
        "The syndicate has been dissolved. Each member's share of the cash, by units, is in their brokerage balance. This is the treasury's last letter.",
        'The books of {syndicate} are closed. Its cash went to the members by their units.',
      ],
    },
  },
});
