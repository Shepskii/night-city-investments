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
    answer: {
      stopped: ["You handled this with dignity. We respect that, for now.", "The matter at {name} is settled. We will remember your composure.", "Well met. {gang} will not trouble {name} further this week."],
      halved: ["You paid part of what was owed. The rest is a debt of honour.", "A partial courtesy from {name}. Partial courtesy earns partial forgiveness.", "You met us halfway. We expect more next time."],
      full: ["You chose to ignore us. {name} has paid for that choice.", "Silence is an answer. Yours has cost you.", "We came, and {name} did not receive us. That was unwise."],
      force: ["You raised a hand against {gang}. That will not be forgotten.", "Our people were turned away by force at {name}. There will be a reckoning.", "You won today. Honour demands we meet again."],
    },
    bigOrderAnswer: {
      stopped: ["The order was handled with discretion. {gang} is pleased.", "Well done. Your back room has earned our regard.", "Delivered as promised. We will remember it."],
      halved: ["The order was handled poorly. We expected better of {name}.", "Sloppy work. It has drawn eyes we would rather it had not.", "A disappointment. Do not repeat it."],
      full: ["You declined our order. We will find another supplier, and remember.", "Your refusal is noted.", "Another time, perhaps. Or perhaps not."],
    },
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
    answer: {
      stopped: ["Fine. You got lucky this time, {name}.", "Alright, we're square. For now.", "You handled it. Respect."],
      halved: ["Half a payment is half a problem. We'll be back for the rest.", "You did something. Not enough.", "Could have gone worse for you. Next time it will."],
      full: ["Ignored us, huh? Hope it was worth what it cost.", "You did nothing. We noticed.", "Told you so, {name}."],
      force: ["You think beating our guys makes you tough? We'll see.", "You put hands on our crew. Big mistake.", "Round one to {name}. There's always a round two."],
    },
    bigOrderAnswer: {
      stopped: ["Job's done, money's good. Nice work.", "Clean. We'll use you again.", "Smooth. Real smooth."],
      halved: ["You botched it. Now everyone's looking.", "Sloppy. Real sloppy.", "That was a mess, {name}."],
      full: ["You passed? Your loss.", "Fine, we'll find someone else.", "Shoulda said yes."],
    },
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
    answer: {
      stopped: ["LUCKY, {name}. Lucky meat.", "Fine. FINE. We go now.", "You got away clean. This time."],
      halved: ["HALF? We wanted ALL of it.", "Not enough, meat. We'll take the rest later.", "Some pain, not enough pain."],
      full: ["You ignored the chrome. The chrome hurt you. Simple.", "HAHA. You did nothing. We did plenty.", "{name} bled. We liked it."],
      force: ["YOU FOUGHT US?? We are coming back with MORE CHROME.", "You broke our boys. We will break more of yours.", "Good fight, meat. Next one you lose."],
    },
    bigOrderAnswer: {
      stopped: ["GOOD PRODUCT. The chrome is happy.", "Job done. You live. Good.", "Delivered. We like you a little now."],
      halved: ["BAD BATCH. We are angry.", "You messed it up, meat.", "Garbage. Do better."],
      full: ["YOU SAID NO? Rude.", "No? Fine. We remember everything.", "Your loss, meat."],
    },
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
    answer: {
      stopped: ["You have shown some virtue, {name}. Be grateful for our mercy.", "Your penance is accepted, for now.", "The faithful are satisfied this week."],
      halved: ["A half-hearted penance. Your sins remain.", "You gave something. Salvation needs more.", "Partial contrition. Partial grace."],
      full: ["You refused the faithful, and suffered for it. As it must be.", "Your silence condemned you.", "The unrepentant pay in full."],
      force: ["You raised violence against the righteous. You will burn for it.", "Our martyrs will be avenged, {name}.", "Sinner. You struck the faithful. We will return."],
    },
    bigOrderAnswer: {
      stopped: ["The work is done. The cause thanks you.", "Your offering serves the faithful.", "Well done, sinner. Well done."],
      halved: ["Your work was flawed, as are you.", "Poorly done. The cause is not served by sloppiness.", "A tainted offering."],
      full: ["You refused the cause. It will be remembered.", "Your refusal is a sin.", "You have chosen corruption."],
    },
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
    answer: {
      stopped: ["Dues settled. Good citizen.", "You did right by the neighbourhood, {name}.", "We're square. Keep it that way."],
      halved: ["Short on your dues, citizen. We'll collect the rest.", "Half your share. Not good enough.", "You owe the neighbourhood more than that."],
      full: ["You turned your back on the neighbourhood. It cost you.", "No dues, no protection. You found out.", "Disloyal. And now you've paid for it."],
      force: ["You fought our patrol. That makes you an enemy of these streets.", "You raised arms against us, {name}. We won't forget.", "Traitor. The unit remembers."],
    },
    bigOrderAnswer: {
      stopped: ["Requisition filled. Good work, citizen.", "The neighbourhood thanks you.", "Delivered right. Respect."],
      halved: ["You fouled up the order, citizen.", "Sloppy. Not up to standard.", "That was a mess."],
      full: ["You refused to serve. Noted.", "Not a team player, {name}.", "We asked. You said no. We remember."],
    },
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
    answer: {
      stopped: ["Ooh, you handled that like a pro, darling. Ratings loved it.", "Fine, you win this episode.", "Well played, superstar."],
      halved: ["Half the show, half the fun. We want more, darling.", "A so-so performance, {name}.", "Mid. Do better next week."],
      full: ["You ignored us? Bad for ratings, worse for you.", "Your episode was a disaster, darling. We loved it.", "Total flop, {name}."],
      force: ["You hurt our cast! The fans are FURIOUS.", "Violence on camera? You'll pay for that ratings spike.", "You made our crew look bad. That's unforgivable, darling."],
    },
    bigOrderAnswer: {
      stopped: ["The party was a HIT. Thanks, superstar!", "Perfect delivery, darling.", "Five stars!"],
      halved: ["The product was meh. The party suffered.", "Bad reviews, darling.", "Not your best work."],
      full: ["You said no? How boring.", "Cancelled, darling. Your loss.", "Fine, we'll find a better supplier."],
    },
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
    answer: {
      stopped: [">> resolved. {name} clean this cycle.", ">> you patched it. noted.", ">> ok. disconnecting."],
      halved: [">> partial compliance. balance outstanding.", ">> half the payload. we keep the rest of your data.", ">> incomplete. we return."],
      full: [">> no response. we executed anyway.", ">> {name} ignored the signal. consequence delivered.", ">> silence logged. cost applied."],
      force: [">> you burned our runners. we have your address. we have everything.", ">> hostile action logged. retaliation queued.", ">> you hit back. bad move."],
    },
    bigOrderAnswer: {
      stopped: [">> delivery confirmed. payment sent. no trace.", ">> clean run. good.", ">> handshake complete."],
      halved: [">> corrupted delivery. trace risk elevated.", ">> sloppy run, {name}.", ">> errors in the job."],
      full: [">> request declined. logged.", ">> you said no. we remember the no.", ">> handshake refused."],
    },
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
    answer: {
      stopped: ["How gracious of you, my dear. We are satisfied.", "A well-handled evening. Bravo.", "You managed us beautifully. Until next time."],
      halved: ["Half a tribute? How very common.", "You made an effort, darling. A modest one.", "Not quite enough, my dear."],
      full: ["You ignored us, and suffered for it. How tragic. How amusing.", "Such bad manners, {name}. Such a costly evening.", "The curtain fell on you, darling."],
      force: ["You struck our company? How vulgar. We shall repay you in kind.", "Violence, my dear? We never forget an insult.", "You have made an enemy of the night."],
    },
    bigOrderAnswer: {
      stopped: ["A delightful delivery, darling. We are charmed.", "Exquisite work.", "The party was divine, thanks to you."],
      halved: ["Rather disappointing, my dear.", "Not up to our standards.", "A clumsy little effort."],
      full: ["You refused us? How very dull.", "We shall find someone more accommodating.", "Such a pity, {name}."],
    },
  },
});
