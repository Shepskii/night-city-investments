/** Every page of a character's account in the Market Terminal, one after another, for checks that don't mind which. */
export async function accountPages(app, render) {
  let html = '';
  for (const sub of ['overview', 'brokerage', 'investments', 'ledger']) {
    app.tab = 'portfolio';
    app.sub = sub;
    html += render('templates/terminal/market.hbs', await app._prepareContext());
  }
  app.tab = 'settings';
  html += render('templates/terminal/market.hbs', await app._prepareContext());
  app.tab = 'portfolio';
  app.sub = 'overview';
  return html;
}
