import { ShippingRule, CalculationResult } from '../types';

export function calculateThrowWeight(length: number, width: number, height: number, throwBase: number): number {
  const base = throwBase && throwBase > 0 ? throwBase : 6000;
  const volume = length * width * height;
  return Math.ceil((volume / base) * 10) / 10;
}

export function calculateBillingWeight(actualWeight: number, throwWeight: number): number {
  return Math.max(actualWeight, throwWeight);
}

export function calculateFirstWeightPlusContinued(
  billingWeight: number,
  firstWeight: number,
  firstPrice: number,
  continuedPrice: number
): { fee: number; steps: string[] } {
  const steps: string[] = [];
  
  if (billingWeight <= firstWeight) {
    steps.push(`计费重${billingWeight.toFixed(2)}KG ≤ 首重${firstWeight}KG，按首重计费：${firstPrice}元`);
    return { fee: firstPrice, steps };
  }
  
  const exceeded = billingWeight - firstWeight;
  const roundedExceeded = Math.ceil(exceeded * 2) / 2;
  const continuedFee = roundedExceeded * continuedPrice;
  const total = firstPrice + continuedFee;
  
  steps.push(`首重${firstWeight}KG：${firstPrice}元`);
  steps.push(`续重${roundedExceeded.toFixed(2)}KG × ${continuedPrice}元/KG = ${continuedFee.toFixed(2)}元`);
  steps.push(`基础运费合计：${total.toFixed(2)}元`);
  
  return { fee: total, steps };
}

export function calculateTieredPrice(
  billingWeight: number,
  tierPrices: Array<{ weight: number; price: number }>,
  continuedPrice: number
): { fee: number; steps: string[] } {
  const steps: string[] = [];
  const sortedTiers = [...tierPrices].sort((a, b) => a.weight - b.weight);
  
  let matchedTier = sortedTiers.find((t, i) => {
    if (i === 0) return billingWeight > 0 && billingWeight <= t.weight;
    return billingWeight > sortedTiers[i - 1].weight && billingWeight <= t.weight;
});
  
  if (!matchedTier) {
    const lastTier = sortedTiers[sortedTiers.length - 1];
    if (billingWeight > lastTier.weight && continuedPrice > 0) {
      const exceeded = billingWeight - lastTier.weight;
      const roundedExceeded = Math.ceil(exceeded * 2) / 2;
      const continuedFee = roundedExceeded * continuedPrice;
      const total = lastTier.price + continuedFee;
      
      steps.push(`超出最高阶梯(${lastTier.weight}KG)，基准价：${lastTier.price}元`);
      steps.push(`续重${roundedExceeded.toFixed(2)}KG × ${continuedPrice}元/KG = ${continuedFee.toFixed(2)}元`);
      steps.push(`基础运费合计：${total.toFixed(2)}元`);
      
      return { fee: total, steps };
    }
    
    steps.push(`超出最高阶梯，按最高阶梯(${lastTier.weight}KG)价格计费：${lastTier.price}元`);
    return { fee: lastTier.price, steps };
  }
  
  steps.push(`计费重${billingWeight.toFixed(2)}KG 匹配阶梯${matchedTier.weight}KG，价格：${matchedTier.price}元`);
  return { fee: matchedTier.price, steps };
}

export function calculateWeightTimesContinuedPlusSurface(
  billingWeight: number,
  continuedPrice: number,
  surfaceFee: number,
  firstPrice: number
): { fee: number; steps: string[] } {
  const steps: string[] = [];
  const weightFee = billingWeight * continuedPrice;
  const total = weightFee + firstPrice + surfaceFee;
  
  steps.push(`计费重量${billingWeight.toFixed(2)}KG × 续重${continuedPrice}元/KG = ${weightFee.toFixed(2)}元`);
  steps.push(`面单费/首重：${firstPrice}元`);
  if (surfaceFee > 0) {
    steps.push(`额外面单费：${surfaceFee}元`);
  }
  steps.push(`基础运费合计：${total.toFixed(2)}元`);
  
  return { fee: total, steps };
}

export function calculateShippingFee(
  actualWeight: number,
  length: number,
  width: number,
  height: number,
  rule: ShippingRule
): CalculationResult {
  const throwWeight = calculateThrowWeight(length, width, height, rule.throwBase);
  const billingWeight = calculateBillingWeight(actualWeight, throwWeight);
  
  const steps: string[] = [];
  steps.push(`📦 实重：${actualWeight}KG，尺寸：${length}×${width}×${height}CM`);
  steps.push(`📐 计抛重量：${length}×${width}×${height}÷${rule.throwBase}=${throwWeight.toFixed(2)}KG`);
  steps.push(`⚖️ 计费重量：MAX(${actualWeight}, ${throwWeight.toFixed(2)})=${billingWeight.toFixed(2)}KG`);
  
  let weightFee = 0;
  let calcSteps: string[] = [];
  
  if (rule.algorithm === 'weightTimesContinuedPlusSurface') {
    const result = calculateWeightTimesContinuedPlusSurface(
      billingWeight,
      rule.continuedPrice,
      rule.surfaceFee,
      rule.firstPrice
    );
    weightFee = billingWeight * rule.continuedPrice;
    calcSteps = result.steps;
  } else if (rule.tierPrices.length > 0 || rule.algorithm === 'tieredPrice') {
    const result = calculateTieredPrice(billingWeight, rule.tierPrices, rule.continuedPrice);
    weightFee = result.fee;
    calcSteps = result.steps;
  } else {
    const result = calculateFirstWeightPlusContinued(
      billingWeight,
      rule.firstWeight,
      rule.firstPrice,
      rule.continuedPrice
    );
    weightFee = result.fee;
    calcSteps = result.steps;
  }
  
  steps.push(...calcSteps);
  
  const surfaceFee = rule.surfaceFee || 0;
  const surcharge = rule.temporarySurcharge || 0;
  
  let totalFee: number;
  if (rule.algorithm === 'weightTimesContinuedPlusSurface') {
    totalFee = Math.round((weightFee + rule.firstPrice + surfaceFee + surcharge) * 100) / 100;
  } else {
    totalFee = Math.round((surfaceFee + weightFee + surcharge) * 100) / 100;
  }
  
  if (rule.algorithm !== 'weightTimesContinuedPlusSurface' && surfaceFee > 0) {
    steps.push(`📄 面单费：${surfaceFee}元`);
  }
  if (surcharge > 0) {
    steps.push(`➕ 临时加价：${surcharge.toFixed(2)}元`);
  }
  steps.push(`✅ 合计：¥${totalFee.toFixed(2)}`);
  
  return {
    company: rule.company,
    region: rule.region,
    hasData: true,
    fee: totalFee,
    actualWeight,
    throwWeight,
    billingWeight,
    breakdown: { surfaceFee, weightFee, surcharge },
    steps,
    algorithm: rule.algorithm,
  };
}

export function isShippingTable(fieldNames: string[]): boolean {
  let requiredCount = 0;
  for (const name of fieldNames) {
    const lower = String(name).toLowerCase();
    if (lower.includes('地区') || lower.includes('省市')) requiredCount++;
    if (lower.includes('价格') || lower.includes('首重') || lower.includes('续重')) requiredCount++;
  }
  return requiredCount >= 2;
}