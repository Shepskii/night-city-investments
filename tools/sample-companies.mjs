/**
 * Sample companies for calibration and tests. Not the shipped starter pack.
 * Volatility and liquidity are 1..5 ratings; beta is sensitivity to the market factor.
 */
export const SAMPLE_COMPANIES = [
  { id: 'ARA', name: 'Arasaka', sector: 'security', initialPrice: 240, volatility: 3, beta: 1.1, liquidity: 5 },
  { id: 'MIL', name: 'Militech', sector: 'arms', initialPrice: 180, volatility: 4, beta: 1.3, liquidity: 4 },
  { id: 'BIO', name: 'Biotechnica', sector: 'biotech', initialPrice: 130, volatility: 3, beta: 0.9, liquidity: 4 },
  { id: 'PET', name: 'Petrochem', sector: 'energy', initialPrice: 95, volatility: 2, beta: 0.8, liquidity: 4 },
  { id: 'TRA', name: 'Trauma Team', sector: 'health', initialPrice: 110, volatility: 2, beta: 0.6, liquidity: 3 },
  { id: 'KAN', name: 'Kang Tao', sector: 'arms', initialPrice: 75, volatility: 4, beta: 1.2, liquidity: 3 },
  { id: 'ZET', name: 'Zetatech', sector: 'tech', initialPrice: 60, volatility: 5, beta: 1.6, liquidity: 2 },
  { id: 'ORB', name: 'Orbital Air', sector: 'transport', initialPrice: 45, volatility: 3, beta: 1.0, liquidity: 3 },
];
