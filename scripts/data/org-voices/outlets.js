/**
 * Papers' voices (M3 step 2): asking a business or a character for comment before a story prints, and telling them
 * how it went. Broadcast is polished and Tabloid is a screamsheet. {outlet} is the paper, {name} the business, {days}
 * the days a character has to answer. English only.
 */

export const OUTLET_VOICES = Object.freeze({
  broadcast: {
    greetings: ['', 'Good evening,'],
    signoffs: ['The {outlet} newsroom', '{outlet} News', ''],
    pressAsk: { lines: [
      'This is {outlet}. We are preparing a report on {name}, and would welcome your comment before broadcast.',
      '{outlet} will be running a story about {name} this week. If you wish to respond, now is the time.',
      'A {outlet} producer is working on a piece about {name}. We would like to include your side.',
    ] },
    resultIgnored: { lines: [
      'Our report on {name} drew little attention. Audiences moved on.',
      'The {name} story did not find an audience.',
      'Our piece on {name} aired, and the city shrugged.',
    ] },
    resultAnswered: { lines: [
      'Our report on {name} landed, but your response carried the day.',
      'Viewers believed our piece on {name}, and then they heard your answer.',
      'The {name} story drew attention, but your statement turned it around.',
    ] },
    resultHalved: { lines: [
      'Our report on {name} landed. Your response softened it, but not entirely.',
      'Viewers believed our piece on {name}. Your answer helped, a little.',
      'The {name} story stuck in part, despite your statement.',
    ] },
    resultFull: { lines: [
      'Our report on {name} landed, and nothing you said changed that.',
      'Viewers believed our piece on {name}, in full.',
      'The {name} story stuck. Your silence, or your answer, made no difference.',
    ] },
    charAsk_money: { lines: ['We have been looking into your finances, and sources are talking.', 'Our team has questions about where your money comes from.'] },
    charAsk_crime: { lines: ['We have been watching who comes and goes around you, and would like a comment on what goes on.', 'We have footage we would like you to explain.'] },
    charAsk_service: { lines: ['We have been collecting complaints from your customers.', 'Viewers have written in about you, and not kindly.'] },
    charAsk_smear: { lines: ['We have a story about you, and we are running it.', 'A story about you is going to air this week, true or not.'] },
    charAsk_dirty: { lines: ['We have been asking who tipped you off, and how you have done so well out of it.', 'Your trading record raises questions we intend to ask on air.'] },
    charAsk_hidden: { lines: ['We have been following the money behind a company you would rather not be linked to.', 'Our investigation has followed a holding back to you.'] },
    charTold: { lines: [
      'We are running a story about you. If you want your side in it, you have {days} days.',
      'You have {days} days to give us a statement before the piece goes out.',
      'The story runs regardless. Respond within {days} days if you want to be heard.',
    ] },
    charIgnored: { lines: ['Our story about you went nowhere. Nobody believed it.', 'Audiences did not take to the story about you.', 'The piece about you aired, and nobody cared.'] },
    charAnswered: { lines: ['People believed our story about you, but your answer killed it.', 'Viewers believed us, until they heard from you.', 'Your statement turned the story about you around.'] },
    charHalved: { lines: ['People believed our story about you, and your answer only took the edge off.', 'Your statement helped, but the story about you stuck in part.', 'The story about you landed, softened by your answer.'] },
    charFull: { lines: ['People believed our story about you, and nothing you said changed that.', 'The story about you stuck, in full.', 'Viewers believed every word of our story about you.'] },
  },

  tabloid: {
    greetings: ['', 'HOT OFF THE PRESS:'],
    signoffs: ['{outlet}: you read it here first!', '- the {outlet} desk', ''],
    pressAsk: { lines: [
      "WHAT'S REALLY GOING ON AT {name}? {outlet} wants to know. Comment now or we print without you.",
      "{outlet} here. We've got dirt on {name}, and it's going to print. Want to say anything?",
      'Big story about {name} dropping this week. Last chance for a quote, chummer.',
    ] },
    resultIgnored: { lines: ['Our {name} scoop flopped. Nobody bit.', 'Turns out nobody cares about {name}. This week.', 'The {name} story died on the newsstand.'] },
    resultAnswered: { lines: ['Readers ate up our {name} story, until you talked them out of it.', 'You spun the {name} story well. We noticed.', 'The {name} scoop was a hit, right up until your answer.'] },
    resultHalved: { lines: ['The {name} story stuck, mostly. Your little statement helped a bit.', 'Readers believed most of the {name} story.', 'Your answer took some sting out of the {name} story. Some.'] },
    resultFull: { lines: ['EVERYBODY believed the {name} story. Nothing you said mattered.', 'The {name} story stuck like glue.', 'Front page, every word believed. Tough break, {name}.'] },
    charAsk_money: { lines: ["Where'd all your money come from? Our sources are talking. Are you?", "We're digging into your eddies, and we found plenty."] },
    charAsk_crime: { lines: ["We've been watching your door, and the people going through it. Care to explain?", 'Who are your friends, and what do they do at night?'] },
    charAsk_service: { lines: ['Your customers HATE you, and they told us all about it.', 'We have a pile of complaints with your name on them.'] },
    charAsk_smear: { lines: ["We've got a story about you. Is it true? Doesn't matter.", "You're our headline this week. Like it or not."] },
    charAsk_dirty: { lines: ['Who tipped you off? Everybody wants to know how you got so lucky.', 'Your trades are too good. Our readers smell a rat.'] },
    charAsk_hidden: { lines: ["We followed the money behind a company, and guess whose name came up.", "Your secret holding isn't so secret any more."] },
    charTold: { lines: [
      "We're running it. You've got {days} days to give us something juicier.",
      'Story prints soon. Talk to us within {days} days, or we tell it our way.',
      "{days} days, chummer. Then it's front page.",
    ] },
    charIgnored: { lines: ['Our story about you was a dud. Lucky you.', 'Nobody believed a word of it. This time.', 'Your story died on the newsstand.'] },
    charAnswered: { lines: ['Readers bought our story about you, then you talked them out of it.', 'You spun it well. Too well.', 'Your comeback killed our story. Respect.'] },
    charHalved: { lines: ['Most of our story about you stuck. Your answer helped a bit.', 'Readers believed most of it.', 'Your statement saved you some face. Some.'] },
    charFull: { lines: ['Everybody believed our story about you. Every word.', 'It stuck, chummer. All of it.', 'Front page, fully believed. Ouch.'] },
  },
});
