/**
 * Gangs' voices (M3 step 2), by style. Each style has optional greetings and sign-offs, and for each kind of mail a
 * `lines` pool and, where it matters, `hostile` (standing is hostile), `heavy` (a heavy shakedown) and `repeat` (the
 * same move within four weeks). {name} is the business, {gang} the gang. English only.
 */

export const GANG_VOICES = Object.freeze({
  formal: {
    greetings: ['Good evening.', 'Forgive the intrusion.', ''],
    signoffs: ['With respect, {gang}.', '{gang} sends its regards.', ''],
    shakedown: {
      lines: [
        'Your business at {name} enjoys the protection of {gang}. This week, that protection has a price. Our representative will call.',
        'A small contribution is expected from {name} this week. We trust you understand the arrangement.',
        'Order on these streets is not free. {name} will contribute this week, as is proper.',
      ],
      hostile: [
        'You have shown us disrespect. {name} will pay for its protection this week, and it will pay in full.',
        'Our patience with {name} is finite. This week you will pay, and you will be polite about it.',
        'There is a debt of honour between us and {name}. We have come to collect it.',
      ],
      heavy: [
        'This is not a request. Our people will be at {name} in numbers this week. Have the money ready, and do not embarrass yourself.',
        'We send more than one representative to {name} this week. Consider what that means.',
        'An example is required. We would prefer it not be {name}.',
      ],
      repeat: [
        'We spoke of this only recently. That we must speak of it again at {name} is disappointing.',
        'Again, {name}. You know the arrangement. Do not make us explain it a third time.',
        'Our last visit to {name} was courteous. Repetition wears courtesy thin.',
      ],
    },
    sabotage: {
      lines: [
        'Machines fail. At {name}, they fail more often than they should. Reflect on why.',
        'An accident at {name}. These things happen to those who forget their obligations.',
        'Your equipment at {name} has been taught a lesson. We hope you learn it too.',
      ],
      repeat: [
        'A second accident at {name}. The pattern should be clear by now.',
        'We were patient. {name} was not attentive. Here is the lesson again.',
        'How many lessons does {name} need?',
      ],
    },
    roomFavour: {
      lines: [
        'Your back room at {name} owes much to our goodwill. We require a favour of it.',
        'A small service is asked of the room behind {name}. It would be wise to oblige.',
        'We have a need your back room can meet. Discretion is expected, as always.',
      ],
      hostile: [
        'You will do this for us. Your back room exists at {name} because we allow it.',
        'A favour is owed, and we are calling it in. Refuse, and we will remember.',
        'Your room at {name} will serve us this week. That is not a question.',
      ],
    },
    roomBigOrder: { lines: [
      'We have a substantial order for your back room at {name}. It pays well. Declining would be unfortunate.',
      'An opportunity: a large order, handled quietly by your room at {name}. We look forward to your answer.',
      'Our associates require goods in quantity. Your back room at {name} is well placed to supply them.',
    ] },
    dealEnded: { lines: [
      'Our arrangement with {name} is at an end. What we invested stays with us.',
      'You have lost our trust. The deal is dissolved, and our stake goes with it.',
      'We withdraw from {name}. Do not seek us out.',
    ] },
  },

  street: {
    greetings: ['Yo.', 'Listen up.', ''],
    signoffs: ['{gang}.', "Don't make us come twice.", ''],
    shakedown: {
      lines: [
        "Protection's due at {name}. Same as always. Have it ready.",
        "Nice place, {name}. Be a shame if something happened to it. We'll be by for our cut.",
        "It's that time of the week. {name} pays, {name} stays open.",
      ],
      hostile: [
        "You've been mouthing off. Price just went up at {name}. Pay it.",
        "We don't like you. Doesn't mean you don't pay. Cash, this week, {name}.",
        'Last chance to play nice, {name}. Pay up or find out.',
      ],
      heavy: [
        "We're bringing the whole crew to {name} this week. Have the money or have a plan.",
        "Heavy visit coming to {name}. Don't be stupid about it.",
        'This week it ain\'t one guy at the door of {name}. It\'s all of us.',
      ],
      repeat: [
        "Didn't we just do this, {name}? Guess we're doing it again.",
        'Back again. Get used to it, {name}.',
        "You're making this a habit, {name}. So are we.",
      ],
    },
    sabotage: {
      lines: [
        "Heard the gear at {name} is playing up. Funny how that happens. Think about who your friends are.",
        'Shame about your equipment, {name}. Real shame.',
        'Something broke at {name}. Something else might.',
      ],
      repeat: [
        'Broke again, huh {name}? Wonder why.',
        'Second time this month. Getting the message yet, {name}?',
        "We can keep doing this all day, {name}.",
      ],
    },
    roomFavour: {
      lines: [
        "Need a favour from the back room at {name}. Don't make us ask twice.",
        "Got a job for your back room. You owe us, {name}.",
        'Your back room does us a solid this week. Easy.',
      ],
      hostile: [
        "You're doing this one for free, {name}. Call it rent.",
        "Back room at {name} works for us this week. Argue and see what happens.",
        "We're not asking nice. Your room, our job.",
      ],
    },
    roomBigOrder: { lines: [
      "Got a big order for the back room at {name}. Good money, and you don't want to say no to us.",
      'Big job. Your room, our product, everybody gets paid. Don\'t screw it up.',
      'Order\'s coming in heavy. {name}\'s back room handles it. Clean.',
    ] },
    dealEnded: { lines: [
      "The deal's off. We're keeping what we put in, and don't come asking for it.",
      "We're done with {name}. Our money stays ours.",
      "Deal's dead. You know why.",
    ] },
  },

  chrome: {
    greetings: ['HEY.', '', 'Listen, meat.'],
    signoffs: ['{gang}. CHROME OR NOTHING.', '', '- {gang}'],
    shakedown: {
      lines: [
        'PAY UP, {name}. The chrome needs feeding.',
        'Eddies, {name}. This week. We hear everything.',
        'Our optics are on {name}. Pay, and they stay pointed somewhere else.',
      ],
      hostile: [
        "WE DON'T LIKE YOU, {name}. Pay or we take it out of your hide.",
        "Every camera at {name} is ours now. Pay up, meat.",
        'You disrespected the chrome. {name} pays double in pain or eddies.',
      ],
      heavy: [
        "THE WHOLE PACK IS COMING TO {name}. bring eddies or bring a medic.",
        'We are coming to {name} with everything bolted on. Have it ready.',
        "Wires hot, blades out. {name}. This week. PAY.",
      ],
      repeat: [
        'AGAIN, {name}. We never forget. We have memory chips.',
        "Back so soon? {name} never learns. We do.",
        "Round two, {name}. The chrome doesn't get tired.",
      ],
    },
    sabotage: {
      lines: [
        'Your machines at {name} screamed all night. We liked it.',
        'Broke your gear, {name}. Felt good.',
        "Static in your systems at {name}? That's us saying hello.",
      ],
      repeat: [
        'MORE BROKEN THINGS AT {name}. Want to see what else breaks?',
        'Again. And again. {name} is our toy now.',
        'We came back for the rest of your equipment, {name}.',
      ],
    },
    roomFavour: {
      lines: [
        'Your back room at {name} works for the chrome this week.',
        "We need your room, {name}. Don't make us rip it out of the wall.",
        'Favour time. The room behind {name} does what we say.',
      ],
      hostile: [
        'YOUR ROOM IS OURS THIS WEEK, {name}.',
        'Do it or we take the room, and you with it.',
        "No pay, no thanks. Just do it, {name}.",
      ],
    },
    roomBigOrder: { lines: [
      'BIG ORDER. Your back room at {name} cooks it. We pay. Nobody bleeds.',
      'We want product, lots of it, from {name}. Say yes, meat.',
      'Huge haul for the room at {name}. Turn it down and see.',
    ] },
    dealEnded: { lines: [
      "DEAL'S SCRAP. We keep our eddies. You keep breathing, for now.",
      "We're done with {name}. Our cash stays with the chrome.",
      'No more deal. {name} is just meat again.',
    ] },
  },

  zealot: {
    greetings: ['Hear us.', 'Blessed are the unaltered.', ''],
    signoffs: ['Repent. {gang}.', 'In purity, {gang}.', ''],
    shakedown: {
      lines: [
        '{name} will tithe to the cause this week. The faithful protect those who give.',
        'A tithe is due from {name}. Give, and be spared the cleansing.',
        'The work of purification requires funds. {name} will provide them.',
      ],
      hostile: [
        '{name} profits from corruption. It will pay penance this week, or be purged.',
        'We have judged {name} and found it wanting. Your tithe doubles as penance.',
        'Sinners pay. {name} pays. This week.',
      ],
      heavy: [
        'The congregation marches on {name} this week. Have your tithe ready, or face the faithful.',
        'Many of us will come to {name}. Pray you are found generous.',
        'A crusade comes to your door, {name}. Pay, and be passed over.',
      ],
      repeat: [
        'Again you test our patience, {name}. Again you will pay.',
        'Your penance is not finished, {name}.',
        'Twice warned. The third time we will not warn.',
      ],
    },
    sabotage: {
      lines: [
        'We have cleansed some of the corruption at {name}. More remains.',
        'Your unholy machines at {name} have been silenced. Reflect.',
        'A purification has taken place at {name}. Be grateful it was only the equipment.',
      ],
      repeat: [
        'The cleansing of {name} continues.',
        'You rebuilt what we destroyed. We have destroyed it again.',
        'There is still impurity at {name}. We will return until there is none.',
      ],
    },
    roomFavour: {
      lines: [
        'Your back room at {name} will serve the cause this week, and be forgiven a little.',
        'The faithful require a service of your hidden room. Do it, and find grace.',
        'Even sinners may do good work. Your room will do ours.',
      ],
      hostile: [
        'Your sinful room at {name} will labour for us, as penance.',
        'Serve, or be cleansed.',
        'The room behind {name} is tolerated only for its use to us. Be useful.',
      ],
    },
    roomBigOrder: { lines: [
      'The cause requires much. Your back room at {name} will supply it, and be rewarded.',
      'A great work needs great supplies. {name} will provide them.',
      'We place a large order with your room at {name}. Refusal would be a sin.',
    ] },
    dealEnded: { lines: [
      'We will no longer soil ourselves with {name}. What we gave stays with the faithful.',
      'Our covenant with {name} is broken, and our offering withdrawn.',
      '{name} is cast out. Do not seek us.',
    ] },
  },

  patriot: {
    greetings: ['Citizen.', 'Listen up, citizen.', ''],
    signoffs: ['Protecting our streets. {gang}.', 'Stay loyal. {gang}.', ''],
    shakedown: {
      lines: [
        'Keeping these streets safe costs money. {name} will contribute its share this week.',
        'Neighbourhood security fee is due from {name}. We keep the scum out; you keep us paid.',
        "Every business on our streets pays its dues. {name}'s are due this week.",
      ],
      hostile: [
        "You're not acting like one of ours, {name}. Your dues just went up.",
        "Traitors pay more. {name} pays this week, and we'll be watching where else your money goes.",
        "We've heard about you, {name}. Pay your dues, and maybe we'll forget it.",
      ],
      heavy: [
        'A full patrol is coming to {name} this week. Have your dues ready, citizen.',
        'The whole unit is visiting {name}. Show some respect.',
        "Muster's at {name} this week. Pay up, or answer to all of us.",
      ],
      repeat: [
        'Again, {name}? A good citizen pays the first time.',
        'Second notice, {name}. There won\'t be a third.',
        'We already reminded you, {name}. This is the last reminder.',
      ],
    },
    sabotage: {
      lines: [
        "Your equipment at {name} had an accident. Disloyal businesses have a lot of those.",
        'Something at {name} broke overnight. Think about whose side you\'re on.',
        'A warning, {name}: we can protect your property, or not.',
      ],
      repeat: [
        "Another accident at {name}. Pick a side.",
        "Your property keeps failing, {name}. Funny, that.",
        'We\'ll keep this up until {name} remembers who it answers to.',
      ],
    },
    roomFavour: {
      lines: [
        'The cause needs a favour from your back room at {name}. Do your duty.',
        'Your room serves the neighbourhood this week, citizen.',
        'We need your back room. Call it service to your community.',
      ],
      hostile: [
        "You'll do this one for us, {name}, and you'll do it right.",
        'Your back room works for us this week. That\'s an order.',
        'Prove your loyalty, {name}. Do the job.',
      ],
    },
    roomBigOrder: { lines: [
      'A large requisition for your back room at {name}. Fill it and be paid well.',
      'Our people need supplies, a lot of them. {name}\'s room can provide.',
      'Big order, citizen. Do it for the neighbourhood, and the money.',
    ] },
    dealEnded: { lines: [
      "Our partnership with {name} is over. We keep our contribution. You know why.",
      'We\'re pulling out of {name}. Disloyalty has a cost.',
      'Deal\'s finished. Don\'t come crying to us.',
    ] },
  },

  glam: {
    greetings: ['Hey, superstar!', 'Darling,', ''],
    signoffs: ['Stay fabulous. {gang}', 'XOXO, {gang}', ''],
    shakedown: {
      lines: [
        "Love what you've done with {name}! Now, about our cut this week...",
        'Every show needs a sponsor, sweetie. This week, {name} is ours.',
        "Protection's due, {name}. Think of it as a fan club fee.",
      ],
      hostile: [
        "You've been rude to us, {name}. Rude people pay extra, darling.",
        "We're not fans of {name} right now. Pay up, or we make you famous for the wrong reasons.",
        "Pay this week, {name}, or we stream what happens next.",
      ],
      heavy: [
        "The whole cast is coming to {name} this week! Have the money, or be the episode.",
        "Big production at {name} this week. Pay, and stay off camera.",
        "We're bringing everyone to {name}, cameras rolling. Smile and pay.",
      ],
      repeat: [
        "Encore, {name}! We just can't stay away.",
        'Back by popular demand at {name}, darling.',
        "Season two, {name}. Same price. Maybe more.",
      ],
    },
    sabotage: {
      lines: [
        "Oops! Did something break at {name}? We got it all on video.",
        'Your equipment at {name} had a dramatic night. Ratings were great.',
        'A little chaos at {name}. Good for the views, bad for you.',
      ],
      repeat: [
        'Sequel! More broken things at {name}.',
        "The fans loved the first one, {name}, so we did it again.",
        'Trending again, {name}. Not in a good way.',
      ],
    },
    roomFavour: {
      lines: [
        "Your back room at {name} has a guest spot on our show this week. Don't miss your cue.",
        'Small favour, darling: your back room, our little project.',
        'We need your room at {name} for something special. Be a sweetheart.',
      ],
      hostile: [
        "You'll do this for us, {name}, or we make you the villain of the week.",
        'Favour time, and no, you don\'t get to say no.',
        'Your room is ours this week, darling. Smile for the cameras.',
      ],
    },
    roomBigOrder: { lines: [
      'Huge order, huge payday! Your back room at {name} is going to be a star.',
      "We need a lot of product for the after-party. {name}'s room is perfect.",
      'Big order, big money. Say yes, superstar.',
    ] },
    dealEnded: { lines: [
      "It's over between us, {name}. We're keeping the money. Don't cry on camera.",
      'Cancelled! {name} is off the show, and our investment comes with us.',
      "We've moved on from {name}, darling. No refunds.",
    ] },
  },

  cryptic: {
    greetings: ['>> connection established', '', '>> signal'],
    signoffs: ['>> {gang} // end', '>> ghosting out', ''],
    shakedown: {
      lines: [
        '>> {name} // tithe due this cycle. we see your accounts. pay.',
        '>> the net remembers {name}. protection costs. this week.',
        '>> {name}. your data is safe with us. for a fee.',
      ],
      hostile: [
        '>> {name} // flagged hostile. tithe doubled. we are already inside.',
        '>> we read every file at {name}. pay, or we publish.',
        '>> your ICE is paper. {name} pays this cycle.',
      ],
      heavy: [
        '>> full crew deploying to {name}. meat and code. pay now.',
        '>> {name} // priority target. bring the eddies to the door.',
        '>> every node and every runner points at {name} this week. comply.',
      ],
      repeat: [
        '>> {name} // second notice. we do not send a third.',
        '>> loop detected: {name} again. break the loop. pay.',
        '>> we came back. we always come back, {name}.',
      ],
    },
    sabotage: {
      lines: [
        '>> {name} // systems compromised. consider this a demonstration.',
        '>> your machines at {name} dreamed of us last night. they did not wake well.',
        '>> a ghost passed through {name}. it broke things.',
      ],
      repeat: [
        '>> {name} // reinfection. you did not patch.',
        '>> again. the daemon is still in your walls, {name}.',
        '>> you rebuilt. we rewrote. {name}.',
      ],
    },
    roomFavour: {
      lines: [
        '>> your back room at {name} has a task. do not log it.',
        '>> favour requested. back room. {name}. no trace.',
        '>> we need your hidden room. it already knows what to do.',
      ],
      hostile: [
        '>> {name} // your room executes our job this cycle. no choice in the code.',
        '>> comply. the room is ours.',
        '>> we own your back room now, {name}. run the task.',
      ],
    },
    roomBigOrder: { lines: [
      '>> large order // back room // {name}. payment on completion. silence always.',
      '>> bulk job queued for {name}. accept the handshake.',
      '>> big run. your room. our eddies. no logs.',
    ] },
    dealEnded: { lines: [
      '>> deal terminated. our stake remains ours. {name} disconnected.',
      '>> {name} // trust revoked. funds withdrawn. do not ping us.',
      '>> link severed.',
    ] },
  },

  oldMoney: {
    greetings: ['My dear,', 'Darling creature,', 'Good evening.'],
    signoffs: ['Ever yours, {gang}.', 'Eternally, {gang}.', ''],
    shakedown: {
      lines: [
        'A modest tribute from {name} is expected this week. We do so hate to be vulgar about these things.',
        "Patronage has its price, my dear. {name}'s is due.",
        'One supports the arts by supporting us. {name} will be generous this week.',
      ],
      hostile: [
        '{name} has been tiresome. Tiresome things become expensive.',
        'You bore us, {name}. Pay handsomely this week, and perhaps we shall forgive it.',
        "How unfortunate that {name} has fallen out of favour. Pay, and the evening may yet end well.",
      ],
      heavy: [
        'The whole company will grace {name} with its presence this week. Do prepare a suitable offering.',
        'We are coming to {name} in force, my dear, and in our finest. Have the tribute waiting.',
        'An evening at {name}, with all of us. It will be memorable either way.',
      ],
      repeat: [
        'Again, {name}? How repetitive. Pay, and spare us the tedium.',
        'We were here only recently. Do try to remember.',
        'A second visit, {name}. We dislike repeating ourselves.',
      ],
    },
    sabotage: {
      lines: [
        'Something at {name} was broken in the night. Such a pity. Such fragile things.',
        'Your instruments at {name} are out of tune now. We prefer silence to bad music.',
        'A small tragedy befell {name}. Tragedies do follow the ungracious.',
      ],
      repeat: [
        'Another tragedy at {name}. Act two.',
        'You replaced what broke. We broke it again. How droll.',
        'The curtain falls on more of {name}, my dear.',
      ],
    },
    roomFavour: {
      lines: [
        'We require a small indulgence from your back room at {name}. Do be accommodating.',
        'A favour, darling. Your hidden room will entertain us this week.',
        'Our tastes are particular. Your back room will satisfy them.',
      ],
      hostile: [
        'You will indulge us, {name}. It is the least you owe.',
        'Your back room is at our disposal this week. How kind of you.',
        "Refuse us, and we shall find {name} terribly dull.",
      ],
    },
    roomBigOrder: { lines: [
      'We are hosting, and require a great deal. Your back room at {name} shall supply it, at a handsome price.',
      'A grand occasion needs grand supplies, darling. {name} will oblige.',
      'A considerable order for your room at {name}. Do not disappoint us.',
    ] },
    dealEnded: { lines: [
      'Our little arrangement with {name} is over, my dear. We keep what we gave. Do not weep.',
      '{name} has lost its charm. We withdraw, and our investment with us.',
      'Adieu, {name}.',
    ] },
  },
});
