export type AlgorithmType = 'firstWeightPlusContinued' | 'tieredPrice' | 'weightTimesContinuedPlusSurface';

export interface ShippingRule {
  company: string;
  region: string;
  firstWeight: number;
  firstPrice: number;
  continuedPrice: number;
  surfaceFee: number;
  temporarySurcharge: number;
  tierPrices: Array<{ weight: number; price: number }>;
  algorithm: AlgorithmType;
  throwBase: number;
}

export interface AlgorithmConfig {
  company: string;
  algorithm: AlgorithmType;
  throwBase: number;
}

export interface CalculationResult {
  company: string;
  region: string;
  hasData: boolean;
  fee: number;
  actualWeight: number;
  throwWeight: number;
  billingWeight: number;
  breakdown: {
    surfaceFee: number;
    weightFee: number;
    surcharge: number;
  };
  steps: string[];
  algorithm: AlgorithmType;
}

export interface FieldMap {
  region: string;
  firstPrice: string;
  continuedPrice: string;
  surfaceFee: string;
  surcharge: string;
  tierPrices: Array<{ weight: number; fieldId: string }>;
}