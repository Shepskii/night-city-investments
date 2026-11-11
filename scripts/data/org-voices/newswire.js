/**
 * The Market Wire's newswire style for headlines (M3 step 5). A dateline with the headline, one line of wire copy by
 * what the news came from (`gig`: off the street; `story`: a paper's piece; `filing`: a company's notice through the
 * Exchange; `gm`: the GM's own news about a company; `market`: news about no one company) and its tone (`up`, `down`,
 * or `lines` for neutral), and a sign-off. The copy never says more than the headline: not who was behind it, nor
 * by how much a price moved. Facts: {name} and {ticker}, for a company's news only. English only.
 */

export const NEWSWIRE = Object.freeze({
  wire: {
    dateline: { dated: 'NIGHT CITY, {date}. {headline}', undated: 'NIGHT CITY. {headline}' },
    signoffs: ['Night City Market Wire', 'Market Wire, Night City desk', 'Filed by the Night City Market Wire'],
    gig: {
      up: [
        'The news came off the street before any press office had it, and traders were quick to look at {ticker}.',
        'Street talk put {name} at the centre of it. Buyers were watching {ticker} closely.',
      ],
      down: [
        'The news came off the street, not from a press office, and holders of {ticker} were looking for the exit.',
        'Street talk around {name} reached the floor fast. {ticker} was under pressure.',
      ],
      lines: [
        'The news came off the street rather than a press office. {name} ({ticker}) had no comment.',
        'Sources on the street put {name} at the centre of it. The company has said nothing.',
        'The wire has not been able to confirm the details with {name}.',
      ],
    },
    story: {
      up: [
        'The piece ran first in the feeds and was picked up across the city. Readers liked what they saw of {name}.',
        'Coverage of {name} was glowing, and the market took note of {ticker}.',
      ],
      down: [
        "The story ran first in the feeds and spread from there. {name} has not answered the wire's requests for comment.",
        'Coverage of {name} was damaging, and traders in {ticker} read it closely.',
      ],
      lines: [
        'The story ran first in the feeds and spread from there.',
        'The wire has asked {name} for comment.',
        'Other outlets were quick to pick up the story.',
      ],
    },
    filing: {
      up: [
        '{name} confirmed the news in a notice to the Exchange. The market took it well.',
        'The news came from {name} itself, through the Exchange. Holders of {ticker} had reason to smile.',
      ],
      down: [
        '{name} confirmed the news in a notice to the Exchange. It made for unhappy reading for holders of {ticker}.',
        'The Exchange published the notice for {name} ({ticker}). It was not welcome news.',
      ],
      lines: [
        '{name} confirmed the news in a notice to the Exchange.',
        'The details are in a notice the Exchange published for {name} ({ticker}).',
        'The Exchange has published the notice for {name}. Holders of {ticker} should read it.',
      ],
    },
    gm: {
      up: ['The news spread quickly, and {ticker} drew buyers.', 'Traders took it as good news for {name}.'],
      down: ['The news spread quickly, and {ticker} met sellers.', 'Traders took it as bad news for {name}.'],
      lines: ['The wire is following the story as it develops.', '{name} ({ticker}) has not commented.', 'More as it comes in.'],
    },
    market: {
      up: ['Traders across the floor took heart.', 'The mood on the floor lifted on the news.'],
      down: ['The mood on the floor darkened on the news.', 'Traders across the floor turned cautious.'],
      lines: ['The wire will follow it as the day goes on.', 'Traders across the floor are watching what comes next.', 'More as it comes in.'],
    },
  },
});
