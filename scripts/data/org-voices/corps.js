/**
 * Corporations' voices (M3 step 2), by style: what a corporation says when it smears a business, and when the back
 * room it stands behind is asked a favour or a big order. `legal` is the fallback for any style without a pool.
 * {name} is the business, {gang} the corporation. English only.
 */

export const CORP_VOICES = Object.freeze({
  formal: {
    greetings: ['', 'Greetings.'],
    signoffs: ['{gang}. Honour. Discipline. Order.', 'Office of External Affairs, {gang}', ''],
    smear: {
      lines: [
        '{gang} has noted the conduct of {name}. People are now hearing of it too. Correct your course.',
        'The reputation of {name} is a fragile thing. {gang} has begun to examine it in public.',
        'Discipline is expected of those who share our streets. {name} has shown none, and the city will know.',
      ],
      repeat: [
        '{gang} spoke of this recently. {name} did not listen. We will speak more loudly.',
        'A second correction for {name}. There will not be a third.',
        'Our patience with {name} is exhausted.',
      ],
    },
    roomFavour: {
      lines: [
        '{gang} requires a discreet service of the operation behind {name}. Your cooperation is valued.',
        'A matter of mutual interest: {gang} asks your back room at {name} for a favour.',
        'Your back room enjoys our forbearance. {gang} asks a service in return.',
      ],
      hostile: [
        '{gang} will have this service from your back room at {name}. Refusal will be noted.',
        'You will assist {gang}. Your operation exists at our discretion.',
        'This is an instruction, not a request.',
      ],
    },
    roomBigOrder: { lines: [
      '{gang} places a substantial order with your back room at {name}, to be handled with absolute discretion. Payment will be generous.',
      'A large requirement has arisen. {gang} expects your back room to meet it.',
      'Volume, discretion and speed. {gang} pays well for all three.',
    ] },
  },

  militarist: {
    greetings: ['', 'Attention.'],
    signoffs: ['{gang} Strategic Communications', 'Mission first. {gang}.', ''],
    smear: {
      lines: [
        '{gang} has opened an information operation against {name}. Expect hostile coverage.',
        'Target acquired: the reputation of {name}. {gang} is engaging.',
        "{name}'s standing in the city is now a contested zone. {gang} holds the high ground.",
      ],
      repeat: [
        'Second sortie against {name}. Effects were insufficient the first time.',
        '{gang} is escalating the campaign against {name}.',
        'Re-engaging {name}. Stand down, or be overrun.',
      ],
    },
    roomFavour: {
      lines: [
        'Tasking order: your back room at {name} supports a {gang} operation this week.',
        '{gang} requires logistical support from your back room. Execute.',
        'Your back room at {name} is assigned to a {gang} task. Report completion.',
      ],
      hostile: [
        'Non-compliance is not an option. Your back room at {name} executes for {gang} this week.',
        'Direct order from {gang}: carry out the task.',
        'You will comply. {gang} does not ask twice.',
      ],
    },
    roomBigOrder: { lines: [
      'Requisition: {gang} needs a large consignment from your back room at {name}. Paid on delivery.',
      'Supply order, priority one. {gang} expects volume and silence.',
      'Large procurement through your back room at {name}. Deliver on schedule.',
    ] },
  },

  wellness: {
    greetings: ['Hi there!', 'Hello from all of us at {gang}!', ''],
    signoffs: ['Wishing you wellness, the {gang} community team', '{gang}: living better, together.', ''],
    smear: {
      lines: [
        "We care about Night City's health, which is why we've shared some concerns about {name} with the public.",
        "At {gang}, we believe in transparency. That's why everyone is hearing about {name} this week.",
        "We've noticed some unhealthy practices at {name}, and we felt the community deserved to know.",
      ],
      repeat: [
        'Our concerns about {name} remain, so we are sharing them again.',
        "We're still worried about {name}, and so, now, is everyone else.",
        "A gentle reminder to the city about {name}. Not so gentle this time.",
      ],
    },
    roomFavour: {
      lines: [
        '{gang} has a small, confidential favour to ask of your back room at {name}. Thank you for being part of our family!',
        'Could your back room help {gang} with a little project? Discretion is a form of care.',
        'A partnership opportunity for your back room, from your friends at {gang}.',
      ],
      hostile: [
        'We need your back room at {name} to help us this week. We really must insist.',
        'Your back room will be assisting {gang}. This is non-negotiable, for everyone\'s wellbeing.',
        'Please do this for us. We would hate for things to become unhealthy.',
      ],
    },
    roomBigOrder: { lines: [
      '{gang} has a large, confidential order for your back room at {name}. Generous compensation, of course!',
      'We need quite a lot, very quietly, from your back room. Let\'s grow together!',
      'A big order, a big thank-you payment. Wellness all round.',
    ] },
  },

  legal: {
    greetings: [''],
    signoffs: ['Legal and Public Affairs, {gang}', 'Office of General Counsel, {gang}', ''],
    smear: {
      lines: [
        '{gang} has made public certain information concerning {name}. You may wish to consider your position.',
        'Please be advised that {gang} has raised concerns about {name} through the media.',
        'Information regarding {name} has entered the public domain with the assistance of {gang}.',
      ],
      repeat: [
        'Further to our previous communication, {gang} has released additional information concerning {name}.',
        'Supplementary disclosure regarding {name} has been made by {gang}.',
        '{gang} has renewed its public concerns about {name}.',
      ],
    },
    roomFavour: {
      lines: [
        '{gang} requests the assistance of your back room at {name} in a confidential matter.',
        'Your cooperation is requested by {gang} on a matter best handled by your back room.',
        '{gang} would value a service from your back room, under the usual understanding.',
      ],
      hostile: [
        '{gang} requires the assistance of your back room at {name}. Non-compliance will be treated accordingly.',
        'You are instructed to assist {gang}. Our previous understanding depends on it.',
        'Failure to assist {gang} in this matter will have consequences.',
      ],
    },
    roomBigOrder: { lines: [
      '{gang} wishes to place a significant order with your back room at {name}, on confidential terms.',
      'A substantial commercial opportunity for your back room, on terms set by {gang}.',
      '{gang} proposes a large, discreet transaction through your back room at {name}.',
    ] },
    dealEnded: { lines: [
      '{gang} hereby terminates its arrangement with {name}. Its contribution is not refundable.',
      'The arrangement between {gang} and {name} is at an end.',
      '{gang} withdraws from {name}, retaining its investment.',
    ] },
  },

  slick: {
    greetings: ['Hey you!', "What's up, {name}!", ''],
    signoffs: ['Stay on brand. {gang}', 'Your friends in marketing at {gang}', ''],
    smear: {
      lines: [
        "Bad news, {name}: you're trending, and it's not a good look. {gang} might have helped with that.",
        "Hey {name}! Our brand team has some thoughts about you, and so does everyone on the feeds now.",
        "{gang} just launched a campaign. Spoiler: it's about {name}, and it isn't flattering.",
      ],
      repeat: [
        "Round two of the {name} campaign is live! Engagement is through the roof.",
        "{name} went viral again. You're welcome!",
        "We're re-running the {name} spot. Audiences love it.",
      ],
    },
    roomFavour: {
      lines: [
        "Quick collab ask: {gang} needs your back room at {name} for a little something. Totally off the books!",
        "Your back room + our project = synergy. Let's make it happen!",
        "{gang} has a favour to ask your back room. Hush-hush, of course.",
      ],
      hostile: [
        "We're not really asking, {name}. Your back room works with {gang} this week.",
        "Do this for us, or the next campaign is about you.",
        'Collab is mandatory this time. Sorry not sorry!',
      ],
    },
    roomBigOrder: { lines: [
      "Huge order incoming for your back room at {name}! Big budget, zero paper trail.",
      "{gang} needs product at scale, quietly. Your back room is our go-to.",
      "Let's do something big together. Really big. Really quiet.",
    ] },
  },
});
