/**
 * Employees' voices (M3 step 3). STAFF_FRAMES: a greeting and a sign-off by Personality. STAFF_LINES: what they write
 * about, by mood (devoted, content, sullen). {name} is the business, {staff} the employee, {other} their other job.
 * English only.
 */

export const STAFF_FRAMES = Object.freeze({
  shy: { greetings: ['Um, hi.', 'Sorry to bother you.', ''], signoffs: ['Sorry. {staff}', '- {staff}', ''] },
  rebellious: { greetings: ['Hey.', 'Look.', ''], signoffs: ['{staff}', 'Deal with it. {staff}', ''] },
  arrogant: { greetings: ['Listen.', 'Right.', ''], signoffs: ['{staff}', "You're welcome. {staff}", ''] },
  moody: { greetings: ['', 'Hey.', 'So.'], signoffs: ['{staff}', 'Whatever. {staff}', ''] },
  picky: { greetings: ['Hello.', 'For the record:', ''], signoffs: ['Regards, {staff}', '{staff}', ''] },
  stable: { greetings: ['Hi boss.', 'Hello.', ''], signoffs: ['Thanks, {staff}', '{staff}', ''] },
  silly: { greetings: ['Heyyy boss!', 'Knock knock!', ''], signoffs: ['Byeee! {staff}', '{staff} :)', ''] },
  sneaky: { greetings: ['Quick word.', 'Between us,', ''], signoffs: ['Delete this. {staff}', '{staff}', ''] },
  intellectual: { greetings: ['Good day.', 'A brief note.', ''], signoffs: ['Yours, {staff}', '{staff}', ''] },
  friendly: { greetings: ['Hey boss!', 'Hi there!', ''], signoffs: ['Take care! {staff}', 'Cheers, {staff}', ''] },
});

export const STAFF_LINES = Object.freeze({
  sickDay: {
    devoted: [
      "I'm really sorry, I'm too sick to come in to {name} this week. I'll be back the moment I can stand.",
      "I hate letting you down, but I'm laid up and can't make it to {name} this week.",
      "Doctor says I'm off my feet for a few days. I'll make it up to {name}, I promise.",
    ],
    content: [
      "I'm not well enough to come in to {name} this week. Sorry.",
      "Caught something nasty. I'll be off this week.",
      'Calling in sick this week. Should be back soon.',
    ],
    sullen: [
      "Not coming in this week. I'm sick. Believe it or don't.",
      "I'm sick. Maybe if {name} paid better I'd be less run down.",
      "Off this week. Don't call.",
    ],
  },
  payDispute: {
    devoted: [
      "I love working at {name}, but the staff are struggling on what we're paid. Can we talk?",
      "I'm with you, boss, but the others are serious about pay. I'd rather we sort it before it gets ugly.",
      'Some of the team are talking about stopping work over pay. I wanted you to hear it from me first.',
    ],
    content: [
      "We need to talk about pay at {name}. The staff aren't working for what we're getting.",
      'The team wants a word about wages. They mean it this time.',
      'Pay at {name} has to go up, or people stop working. That\'s where it is.',
    ],
    sullen: [
      "We're done working for scraps at {name}. Pay up or we down tools.",
      'You can run {name} on your own if you want. Or pay us properly.',
      'No raise, no work. Simple as that.',
    ],
  },
  poaching: {
    devoted: [
      "Someone's offered me a better job. I don't want to leave {name}, but I thought you should know.",
      "I've had an offer elsewhere. I'd rather stay. Can we talk?",
      "A rival wants me. Honestly, I'd stay for a reason.",
    ],
    content: [
      "I've had an offer of another job, a better one. Thought you should know before I decide.",
      'Got an offer from elsewhere. Thinking about it.',
      "Someone's trying to hire me away from {name}. Just saying.",
    ],
    sullen: [
      "Got a better offer. Give me one reason to stay at {name}.",
      "Someone actually values me. Might take their offer.",
      "I'm probably leaving. Unless you make it worth my while.",
    ],
  },
  accident: {
    devoted: [
      "I got hurt on the job at {name}. I'm okay, mostly. I'll be back as soon as I can.",
      "There was an accident at work. I'm patched up, but I'll need some help.",
      "Took a knock at {name}. Don't worry about me, worry about the shift.",
    ],
    content: [
      "I've been hurt on the job at {name}. I'm going to need some help.",
      "Accident at work. I'm out until I heal.",
      "Got hurt on shift. Need medical, and some time off.",
    ],
    sullen: [
      "I got hurt at {name}. Told you that place was a deathtrap.",
      'Injured on the job. Who\'s paying for this?',
      "Hurt again. Safety at {name} is a joke.",
    ],
  },
  doubleBooked: {
    devoted: [
      "My other job at {other} wants me this week too. I'll do my best to cover {name}.",
      "{other} has me on the same shifts. I'm trying to sort it, I promise.",
      'Bit of a clash with {other} this week. Can you help me juggle it?',
    ],
    content: [
      "My other job at {other} wants me in this week as well, and I can't be in two places at once.",
      '{other} needs me the same days as {name}. Something has to give.',
      'Double-booked with {other} this week. Your call.',
    ],
    sullen: [
      "{other} wants me this week. They pay on time, so.",
      "Can't do both. {other} gets me unless you make it worth it.",
      "{other} has me this week. Sort yourself out.",
    ],
  },
  fullTimeOffer: {
    devoted: [
      "{other} has offered me full time. I'd rather stay at {name}, though. Can we work something out?",
      'Full-time offer from {other}. My heart\'s at {name}, but my rent isn\'t.',
      '{other} wants me full time. Talk me out of it?',
    ],
    content: [
      'My other job at {other} has offered me full time. Give me a reason to stay at {name}.',
      '{other} wants me full time. Thinking it over.',
      'Got a full-time offer from {other}. Just letting you know.',
    ],
    sullen: [
      "{other} wants me full time. Honestly, I'm tempted.",
      'Full-time at {other} sounds better than this.',
      "{other} made me an offer. Beat it or lose me.",
    ],
  },
  asks: {
    devoted: [
      "I've been giving {name} everything. I think I've earned a raise. What do you say?",
      'I love this job, but I could use a little more. Any chance of a raise?',
      "Not to be pushy, but a raise would mean a lot. I'm not going anywhere either way.",
    ],
    content: [
      'I think it\'s time we talked about a raise.',
      "I'd like a raise. I've been pulling my weight at {name}.",
      'Requesting a pay rise. Let me know.',
    ],
    sullen: [
      "I want a raise. Or I want out.",
      "Pay me more, or don't be surprised when I stop showing up.",
      "I'm worth more than {name} pays. Fix it.",
    ],
  },
  quit: { lines: [
    "I'm done with {name}. Don't bother calling.",
    "I quit. Find someone else.",
    "That's it, I'm out. Good luck with {name}.",
  ] },
  walked: { lines: [
    "I walked. You know why.",
    "Not coming back to {name}. Ever.",
    "I've had enough. I'm gone.",
  ] },
  unpaid: { lines: [
    "No pay, no work. I'm gone from {name}.",
    "Weeks without wages? I quit.",
    "You stopped paying me, so I stopped working. Goodbye.",
  ] },
  poached: { lines: [
    "I took the other job. Sorry, {name}, they made me an offer I couldn't refuse.",
    "I've moved on. Better money elsewhere.",
    "Took the offer. No hard feelings. Mostly.",
  ] },
});
