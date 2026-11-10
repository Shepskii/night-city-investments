/**
 * Employers' voices (M3 step 3). An NPC owner frames their mail by Personality (OWNER_FRAMES) around lines shared by
 * all owners (OWNER_LINES); a corporation's HR writes in its corporation's style (HR_VOICES, the styles of step 2,
 * with Legal for any other). A payslip's note goes by the employee's performance band (thinIce, shaky, reliable,
 * trusted). {name} is the business, {post} the role, {wage} a week's wage, {paid} what they're paid on leaving.
 * English only.
 */

export const OWNER_FRAMES = Object.freeze({
  shy: { greetings: ['Hi.', ''], signoffs: ['Thanks.', ''] },
  rebellious: { greetings: ['Hey.', ''], signoffs: ["Don't make me regret it.", ''] },
  arrogant: { greetings: ['Listen carefully.', ''], signoffs: ['You can thank me later.', ''] },
  moody: { greetings: ['', 'Fine.'], signoffs: ['Whatever.', ''] },
  picky: { greetings: ['To be clear:', ''], signoffs: ['Precisely as stated.', ''] },
  stable: { greetings: ['Hello.', ''], signoffs: ['Regards.', ''] },
  silly: { greetings: ['Ta-da!', 'Hiya!'], signoffs: ['Toodles!', ''] },
  sneaky: { greetings: ['Between you and me,', ''], signoffs: ["Let's keep this quiet.", ''] },
  intellectual: { greetings: ['A note.', ''], signoffs: ['Consider it.', ''] },
  friendly: { greetings: ['Hey there!', 'Hi!'], signoffs: ['Cheers!', 'Take care!'] },
});

export const OWNER_LINES = Object.freeze({
  hired: { lines: [
    "You're hired at {name}, as {post}, on {wage} eb a week. You start now.",
    'Welcome to {name}. The {post} job is yours at {wage} eb a week. Start today.',
    "The {post} spot at {name} is yours. {wage} eb a week, starting now.",
  ] },
  turned: { lines: [
    "{name} won't be taking you on as {post}.",
    "Sorry, the {post} job at {name} isn't yours.",
    "We've gone another way for {post} at {name}.",
  ] },
  warned: { lines: [
    "A word from {name}: your work hasn't been good enough. Turn things around this week, or you're finished here.",
    "You're slipping at {name}. One more poor week and you're out.",
    "This is your warning. Pick it up at {name}, or don't come back.",
  ] },
  sacked: { lines: [
    "{name} has let you go. You're paid {paid} eb in lieu of notice.",
    "You're done at {name}. {paid} eb for your notice, and that's it.",
    "Clear your locker at {name}. {paid} eb in lieu of notice.",
  ] },
  promoted: { lines: [
    "{name} is pleased with you: your pay goes up to {wage} eb a week.",
    "Good work. Your wage at {name} rises to {wage} eb a week.",
    "You've earned it: {wage} eb a week from now on at {name}.",
  ] },
  payslip: {
    thinIce: ["Here's your pay. You know where you stand.", 'Pay attached. Think hard about next week.'],
    shaky: ['Pay attached. Could be better, could be worse.', "Here's your wage. Let's see more from you."],
    reliable: ['Your pay, as always. Good week.', 'Wage attached. Steady work, thanks.'],
    trusted: ["Your pay. Couldn't run the place without you.", 'Wage attached, and well earned.'],
    lines: ['Your pay is attached.'],
  },
});

export const HR_VOICES = Object.freeze({
  formal: {
    greetings: ['Esteemed employee,', ''],
    signoffs: ['Human Resources, {name}. Loyalty is rewarded.', 'Personnel Department, {name}'],
    hired: { lines: [
      'Your appointment to {name} as {post} is confirmed, at {wage} eb a week. Report for duty immediately.',
      '{name} accepts you into its service as {post}. Remuneration: {wage} eb a week. Your service begins now.',
      'You have been selected for the position of {post} at {name}, at {wage} eb weekly. Serve with honour.',
    ] },
    turned: { lines: [
      'Your application to {name} for the position of {post} has not been successful.',
      '{name} will not be offering you the position of {post}.',
      'After due consideration, {name} declines your application for {post}.',
    ] },
    warned: { lines: [
      'Your conduct at {name} has fallen below the standard expected. A further failure will end your service.',
      'This is a formal warning from {name}. Your performance is unacceptable.',
      'Discipline is expected. Correct your performance at {name} immediately.',
    ] },
    sacked: { lines: [
      'Your service with {name} is terminated. {paid} eb is paid in lieu of notice.',
      '{name} releases you from its service, with {paid} eb in lieu of notice.',
      'Your employment at {name} has ended. Severance: {paid} eb.',
    ] },
    promoted: { lines: [
      'In recognition of your service, {name} raises your pay to {wage} eb a week.',
      'Your loyalty to {name} is rewarded: your wage rises to {wage} eb a week.',
      '{name} promotes you. New remuneration: {wage} eb weekly.',
    ] },
    payslip: {
      thinIce: ['Remuneration enclosed. Your record is under review.'],
      shaky: ['Remuneration enclosed. Improvement is expected.'],
      reliable: ['Remuneration enclosed. Your service is noted.'],
      trusted: ['Remuneration enclosed, with the gratitude of the company.'],
      lines: ['Remuneration enclosed.'],
    },
  },
  militarist: {
    greetings: ['', 'Attention, operator.'],
    signoffs: ['{name} Personnel Command', 'HR Division, {name}'],
    hired: { lines: [
      'Enlistment confirmed: you are assigned to {name} as {post}, at {wage} eb a week. Report now.',
      'Welcome to {name}. Assignment: {post}. Pay grade: {wage} eb weekly. Effective immediately.',
      '{name} has assigned you to {post} at {wage} eb a week. Move out.',
    ] },
    turned: { lines: [
      'Application for {post} at {name}: rejected.',
      "{name} won't be assigning you to {post}.",
      'You did not make the cut for {post} at {name}.',
    ] },
    warned: { lines: [
      'Performance below standard. One more failure and you are discharged from {name}.',
      'Formal reprimand from {name}. Shape up.',
      'Your unit at {name} reports poor performance. Correct it.',
    ] },
    sacked: { lines: [
      'You are discharged from {name}. {paid} eb severance has been paid.',
      'Discharge order: your service at {name} ends. Severance {paid} eb.',
      'Dismissed from {name}, with {paid} eb in lieu of notice.',
    ] },
    promoted: { lines: [
      'Promotion granted. New pay grade at {name}: {wage} eb a week.',
      'Field promotion: your wage at {name} rises to {wage} eb weekly.',
      'Commendation and promotion. {wage} eb a week from now.',
    ] },
    payslip: {
      thinIce: ['Pay issued. You are on report.'],
      shaky: ['Pay issued. Performance noted. Do better.'],
      reliable: ['Pay issued. Solid work, operator.'],
      trusted: ['Pay issued. Exemplary service.'],
      lines: ['Pay issued.'],
    },
  },
  wellness: {
    greetings: ['Hi there!', 'Hello, team member!'],
    signoffs: ['Your People & Wellbeing team at {name}', 'With care, {name} HR'],
    hired: { lines: [
      "Welcome to the {name} family! You're our new {post}, at {wage} eb a week. Your journey starts now!",
      "We're so happy to have you as {post} at {name}! {wage} eb a week, starting today.",
      "Great news: you're joining {name} as {post}, on {wage} eb a week. Let's grow together!",
    ] },
    turned: { lines: [
      "Thank you for applying to {name}! We won't be moving forward for {post} this time.",
      "We loved meeting you, but {post} at {name} isn't the right fit right now.",
      "Your {post} application to {name} wasn't successful. Keep growing!",
    ] },
    warned: { lines: [
      "We've noticed your wellness metrics at {name} are slipping. Let's turn things around this week, or we'll need to part ways.",
      'This is a supportive check-in from {name}: your performance needs to improve, urgently.',
      "We care about you, which is why we're warning you: one more poor week and your journey at {name} ends.",
    ] },
    sacked: { lines: [
      "We're sad to say your journey with {name} has ended. {paid} eb is on its way to you in lieu of notice.",
      "Your time at {name} is over. We've included {paid} eb to help with the transition.",
      'We wish you the best outside {name}. Severance: {paid} eb.',
    ] },
    promoted: { lines: [
      'Congratulations! Your growth at {name} is rewarded: your pay is now {wage} eb a week.',
      "You're thriving at {name}! New wage: {wage} eb a week.",
      'A raise for a rising star: {wage} eb a week at {name}.',
    ] },
    payslip: {
      thinIce: ["Here's your pay. Remember, our wellness team is here if you're struggling."],
      shaky: ["Here's your pay! We believe in your potential."],
      reliable: ["Here's your pay! Thanks for being part of the family."],
      trusted: ["Here's your pay, superstar! You make {name} shine."],
      lines: ["Here's your pay!"],
    },
  },
  legal: {
    greetings: [''],
    signoffs: ['Human Resources, {name}', 'Employee Relations, {name}'],
    hired: { lines: [
      'Your employment with {name} as {post} commences immediately, at {wage} eb a week.',
      '{name} offers you the position of {post} at {wage} eb weekly, effective today.',
      'Employment confirmed: {post}, {name}, {wage} eb a week, from today.',
    ] },
    turned: { lines: [
      'Your application for the position of {post} at {name} has been unsuccessful.',
      '{name} regrets that it cannot offer you the position of {post}.',
      'Application outcome, {post} at {name}: unsuccessful.',
    ] },
    warned: { lines: [
      'This is a final written warning from {name} regarding your performance. A further poor week will result in dismissal.',
      'Notice of unsatisfactory performance: {name}. Improvement is required this week.',
      '{name} is issuing you a formal warning. Your continued employment depends on improvement.',
    ] },
    sacked: { lines: [
      'Your employment with {name} is terminated. {paid} eb is paid in lieu of notice.',
      'Notice of dismissal, {name}. Payment in lieu of notice: {paid} eb.',
      '{name} has ended your employment. {paid} eb has been paid in lieu of notice.',
    ] },
    promoted: { lines: [
      'Your remuneration at {name} is increased to {wage} eb a week, with immediate effect.',
      'Salary review, {name}: increased to {wage} eb weekly.',
      '{name} confirms your promotion, at {wage} eb a week.',
    ] },
    payslip: {
      thinIce: ['Payment enclosed. Your performance remains under review.'],
      shaky: ['Payment enclosed. Performance: below expectations.'],
      reliable: ['Payment enclosed. Performance: satisfactory.'],
      trusted: ['Payment enclosed. Performance: exemplary.'],
      lines: ['Payment enclosed.'],
    },
  },
  slick: {
    greetings: ['Hey you!', 'Hiii!'],
    signoffs: ['Team Talent, {name}', 'Your HR crew at {name}'],
    hired: { lines: [
      "You got it! You're our new {post} at {name}, on {wage} eb a week. Starting NOW!",
      "Big welcome to {name}! {post}, {wage} eb a week, let's go!",
      'Say hello to your new job: {post} at {name}, {wage} eb weekly!',
    ] },
    turned: { lines: [
      "Not this time! {name} is passing on you for {post}.",
      "{post} at {name} went to someone else. Keep hustling!",
      "Sorry, the {post} gig at {name} isn't yours.",
    ] },
    warned: { lines: [
      "Real talk: your numbers at {name} are bad. Fix it this week or you're out.",
      'Quick heads-up from {name}: one more bad week and we part ways.',
      "Your vibe at {name} is off. Turn it around, fast.",
    ] },
    sacked: { lines: [
      "That's a wrap at {name}! {paid} eb for your notice. Good luck out there!",
      "We're letting you go from {name}. {paid} eb in lieu of notice.",
      "It's not us, it's you. {name} pays you {paid} eb to go.",
    ] },
    promoted: { lines: [
      "Level up! Your pay at {name} is now {wage} eb a week!",
      "You're crushing it: {wage} eb a week from now on at {name}!",
      "Promo time! {wage} eb a week. Keep shining!",
    ] },
    payslip: {
      thinIce: ['Pay drop! Real talk, we need more from you.'],
      shaky: ['Pay drop! You can do better.'],
      reliable: ['Pay drop! Nice work this week.'],
      trusted: ['Pay drop! You absolute legend.'],
      lines: ['Pay drop!'],
    },
  },
});
