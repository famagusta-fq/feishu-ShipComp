import { useState, useEffect, useCallback, useRef } from 'react';
import { bitable } from '@lark-base-open/js-sdk';
import { ShippingRule, CalculationResult, AlgorithmType } from './types';
import { calculateShippingFee, isShippingTable } from './utils/calculator';
import './App.css';

const mockRules: ShippingRule[] = import.meta.env.DEV ? [
  {
    company: '申通',
    region: '北京',
    firstWeight: 1,
    firstPrice: 12,
    continuedPrice: 8,
    throwBase: 6000,
    surfaceFee: 0,
    algorithm: 'firstWeightPlusContinued',
    tierPrices: [],
    temporarySurcharge: 0,
  },
  {
    company: '申通',
    region: '上海',
    firstWeight: 1,
    firstPrice: 10,
    continuedPrice: 6,
    throwBase: 6000,
    surfaceFee: 0,
    algorithm: 'firstWeightPlusContinued',
    tierPrices: [],
    temporarySurcharge: 0,
  },
  {
    company: '韵达',
    region: '北京',
    firstWeight: 1,
    firstPrice: 0,
    continuedPrice: 0,
    throwBase: 6000,
    surfaceFee: 0,
    algorithm: 'tieredPrice',
    tierPrices: [
      { weight: 0.5, price: 2.7 },
      { weight: 1, price: 3.1 },
      { weight: 2, price: 4.5 },
      { weight: 3, price: 5.9 },
    ],
    temporarySurcharge: 0,
  },
  {
    company: '韵达',
    region: '上海',
    firstWeight: 1,
    firstPrice: 0,
    continuedPrice: 0,
    throwBase: 6000,
    surfaceFee: 0,
    algorithm: 'tieredPrice',
    tierPrices: [
      { weight: 0.5, price: 2.5 },
      { weight: 1, price: 2.9 },
      { weight: 2, price: 4.2 },
      { weight: 3, price: 5.5 },
    ],
    temporarySurcharge: 0,
  },
  {
    company: '中通',
    region: '北京',
    firstWeight: 1,
    firstPrice: 15,
    continuedPrice: 10,
    throwBase: 6000,
    surfaceFee: 1,
    algorithm: 'weightTimesContinuedPlusSurface',
    tierPrices: [],
    temporarySurcharge: 0,
  },
  {
    company: '顺丰',
    region: '北京',
    firstWeight: 1,
    firstPrice: 23,
    continuedPrice: 13,
    throwBase: 6000,
    surfaceFee: 0,
    algorithm: 'firstWeightPlusContinued',
    tierPrices: [],
    temporarySurcharge: 0,
  },
] : [];

const SDK_TIMEOUT = 30000;
const SDK_POLL_INTERVAL = 500;

function App() {
  const [form, setForm] = useState({
    weight: '',
    length: '',
    width: '',
    height: '',
    region: '',
  });

  const [rules, setRules] = useState<ShippingRule[]>([]);
  const [results, setResults] = useState<CalculationResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  

  const getText = (val: unknown): string => {
    if (val === null || val === undefined) return '';
    if (Array.isArray(val)) return val.join(',');
    return String(val);
  };

  const getNum = (val: unknown, defaultVal: number): number => {
    const num = parseFloat(getText(val));
    return isNaN(num) ? defaultVal : num;
  };

  const parseAlgorithm = (algorithmStr: string): AlgorithmType => {
    const lower = algorithmStr.toLowerCase();
    if (lower.includes('阶梯') || lower.includes('分段')) return 'tieredPrice';
    if (lower.includes('×续重+面单') || lower.includes('*续重+面单')) return 'weightTimesContinuedPlusSurface';
    return 'firstWeightPlusContinued';
  };

  const loadRules = useCallback(async () => {
    if (!bitable || !bitable.base || typeof bitable.base.getTableMetaList !== 'function') {
      if (import.meta.env.DEV && mockRules.length > 0) {
        setStatus('本地开发模式，使用Mock数据...');
        setTimeout(() => {
          setRules(mockRules);
          setStatus(`已识别 ${mockRules.length} 条报价`);
        }, 500);
      } else {
        setStatus('SDK未就绪，请稍候...');
      }
      return;
    }

    setLoading(true);
    setStatus('正在读取表格...');
    setRules([]);

    try {
      const tablesResult = await bitable.base.getTableMetaList();
      const tables = Array.isArray(tablesResult) ? tablesResult : (tablesResult as any)?.data || [];

      const shippingTables: Array<{ id: string; name: string; fieldMap: Record<string, string> }> = [];
      const algoConfigs: Array<{ company: string; algorithm: AlgorithmType; throwBase: number }> = [];

      for (const tableMeta of tables) {
        const tableName = tableMeta.name || tableMeta.tableName || '未知';
        try {
          const table = await bitable.base.getTableById(tableMeta.id);
          const fields = await table.getFieldMetaList();
          const fieldMap: Record<string, string> = {};
          const fieldNames: string[] = [];

          fields.forEach((f: any) => {
            const name = String(f.name).trim();
            fieldMap[f.id] = name;
            fieldNames.push(name);
          });

          const isAlgoTable = tableName.includes('算法') || tableName.includes('配置');
          if (isAlgoTable) {
            const records = (await table.getRecords({})).records || [];
            for (const record of records) {
              const fs = record.fields as Record<string, unknown>;
              let company = '';
              let algorithm = '';
              let throwBase = 6000;

              for (const [fId, fVal] of Object.entries(fs)) {
                const fname = fieldMap[fId] || '';
                const lname = fname.toLowerCase();
                if (!company && (lname.includes('快递') || lname.includes('公司') || lname.includes('名称'))) {
                  company = getText(fVal).trim();
                }
                if (!algorithm && (lname.includes('算法') || lname.includes('计费'))) {
                  algorithm = getText(fVal).trim();
                }
                if (throwBase === 6000 && (lname.includes('记抛') || lname.includes('计抛'))) {
                  throwBase = getNum(fVal, 6000);
                }
              }

              if (company) {
                algoConfigs.push({ company, algorithm: parseAlgorithm(algorithm), throwBase });
              }
            }
            continue;
          }

          if (isShippingTable(fieldNames)) {
            shippingTables.push({ id: tableMeta.id, name: tableName, fieldMap });
          }
        } catch (err) {
          console.error('读取表格失败:', tableName, err);
        }
      }

      const allRules: ShippingRule[] = [];

      for (const { id, name, fieldMap } of shippingTables) {
        try {
          const table = await bitable.base.getTableById(id);

          let regionField = '';
          let firstPriceField = '';
          let continuedPriceField = '';
          let surfaceFeeField = '';
          let surchargeField = '';
          const tierFields: Array<{ weight: number; fieldId: string }> = [];

          for (const [fId, fName] of Object.entries(fieldMap)) {
            const lname = fName.toLowerCase();
            if (!regionField && (lname.includes('地区') || lname.includes('省市'))) regionField = fId;
            if (!firstPriceField && (lname.includes('首重') || lname.includes('公斤'))) firstPriceField = fId;
            if (!continuedPriceField && lname.includes('续重')) continuedPriceField = fId;
            if (!surfaceFeeField && lname.includes('面单')) surfaceFeeField = fId;
            if (!surchargeField && (lname.includes('加价') || lname.includes('附加'))) surchargeField = fId;

            const tierMatch = fName.match(/(\d+\.?\d*)\s*(kg|KG|公斤)/);
            if (tierMatch) {
              const weight = parseFloat(tierMatch[1]);
              if (weight > 0) tierFields.push({ weight, fieldId: fId });
            }
          }

          tierFields.sort((a, b) => a.weight - b.weight);

          const records = (await table.getRecords({})).records || [];

          const algoConfig = algoConfigs.find(c => {
            const cleanName = name.replace(/\s/g, '');
            const cleanCompany = c.company.replace(/\s/g, '');
            return cleanName.includes(cleanCompany) || cleanCompany.includes(cleanName);
          });

          for (const record of records) {
            const fs = record.fields as Record<string, unknown>;

            let region = '';
            if (regionField && fs[regionField] !== undefined) {
              region = getText(fs[regionField]).trim();
            } else {
              for (const [fId, fVal] of Object.entries(fs)) {
                const fname = fieldMap[fId] || '';
                if (fname.includes('地区') || fname.includes('省市')) {
                  region = getText(fVal).trim();
                  break;
                }
              }
            }

            if (!region) continue;

            const firstPrice = firstPriceField ? getNum(fs[firstPriceField], 0) : 0;
            const continuedPrice = continuedPriceField ? getNum(fs[continuedPriceField], 0) : 0;
            const surfaceFee = surfaceFeeField ? getNum(fs[surfaceFeeField], 0) : 0;
            const surcharge = surchargeField ? getNum(fs[surchargeField], 0) : 0;

            const tierPrices = tierFields.map(t => ({
              weight: t.weight,
              price: getNum(fs[t.fieldId], 0),
            })).filter(t => t.price > 0);

            let algorithm: AlgorithmType;
            if (algoConfig?.algorithm) {
              algorithm = algoConfig.algorithm;
            } else if (tierPrices.length > 0) {
              algorithm = 'tieredPrice';
            } else if (surfaceFee > 0 && continuedPrice > 0 && firstPrice === 0) {
              algorithm = 'weightTimesContinuedPlusSurface';
            } else {
              algorithm = 'firstWeightPlusContinued';
            }

            const throwBase = algoConfig?.throwBase || 6000;

            allRules.push({
              company: name,
              region,
              firstWeight: 1,
              firstPrice,
              continuedPrice,
              surfaceFee,
              temporarySurcharge: surcharge,
              tierPrices,
              algorithm,
              throwBase,
            });
          }
        } catch (err) {
          console.error('读取报价失败:', name, err);
        }
      }

      setRules(allRules);
      setStatus(`已识别 ${new Set(allRules.map(r => r.company)).size} 家快递，${allRules.length} 条报价`);
    } catch (err) {
      setStatus('加载失败: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const sdkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeRef = useRef(Date.now());

  useEffect(() => {
    const checkSdkReady = () => {
      if (bitable && bitable.base && typeof bitable.base.getTableMetaList === 'function') {
        if (timeoutTimerRef.current) {
          clearTimeout(timeoutTimerRef.current);
          timeoutTimerRef.current = null;
        }
        loadRules();
        return;
      }

      if (import.meta.env.DEV && mockRules.length > 0) {
        loadRules();
        return;
      }

      if (Date.now() - startTimeRef.current > SDK_TIMEOUT) {
        setStatus('SDK初始化超时，请刷新重试');
        return;
      }

      setStatus('SDK初始化中...');
      sdkTimerRef.current = setTimeout(checkSdkReady, SDK_POLL_INTERVAL);
    };

    timeoutTimerRef.current = setTimeout(() => {
      if (sdkTimerRef.current) {
        clearTimeout(sdkTimerRef.current);
        sdkTimerRef.current = null;
      }
      setStatus('SDK初始化超时，请刷新重试');
    }, SDK_TIMEOUT);

    checkSdkReady();

    return () => {
      if (sdkTimerRef.current) clearTimeout(sdkTimerRef.current);
      if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
    };
  }, [loadRules]);

  const calculate = useCallback(() => {
    if (!form.weight || !form.region) {
      setStatus('请输入重量和收件地区');
      return;
    }

    const weight = parseFloat(form.weight);
    if (isNaN(weight) || weight <= 0) {
      setStatus('请输入有效的重量');
      return;
    }

    const length = parseFloat(form.length || '0');
    const width = parseFloat(form.width || '0');
    const height = parseFloat(form.height || '0');

    const filteredRules = rules.filter(r => 
      r.region.includes(form.region) || form.region.includes(r.region)
    );

    if (filteredRules.length === 0) {
      setStatus(`未找到 ${form.region} 的报价`);
      setResults([]);
      return;
    }

    const calculated = filteredRules.map(rule => {
      const result = calculateShippingFee(
        weight,
        length,
        width,
        height,
        rule
      );
      return {
        ...result,
        company: rule.company,
        region: rule.region,
      };
    }).sort((a, b) => a.fee - b.fee);

    setResults(calculated);
    setStatus(`计算完成，共 ${calculated.length} 个方案`);
  }, [form, rules]);

  const handleInputChange = (field: keyof typeof form, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const minPrice = results.length > 0 ? Math.min(...results.map(r => r.fee)) : 0;

  return (
    <div className="app">
      <div className="header">
        <h1>📦 万能电商本地运费比价器</h1>
        <p className="subtitle">完全动态适配·智能对比最优方案</p>
      </div>

      <div className="status-bar">{status}</div>

      <div className="form-section">
        <div className="input-group">
          <label>实际重量 (KG)</label>
          <input
            type="number"
            step="0.1"
            min="0"
            value={form.weight}
            onChange={(e) => handleInputChange('weight', e.target.value)}
            placeholder="请输入重量"
          />
        </div>

        <div className="dimensions">
          <div className="input-group">
            <label>长度 (CM)</label>
            <input
              type="number"
              min="0"
              value={form.length}
              onChange={(e) => handleInputChange('length', e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="input-group">
            <label>宽度 (CM)</label>
            <input
              type="number"
              min="0"
              value={form.width}
              onChange={(e) => handleInputChange('width', e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="input-group">
            <label>高度 (CM)</label>
            <input
              type="number"
              min="0"
              value={form.height}
              onChange={(e) => handleInputChange('height', e.target.value)}
              placeholder="0"
            />
          </div>
        </div>

        <div className="input-group">
          <label>收件省市</label>
          <input
            type="text"
            value={form.region}
            onChange={(e) => handleInputChange('region', e.target.value)}
            placeholder="请输入收件地区"
          />
        </div>

        <button onClick={calculate} disabled={loading} className="btn-primary">
          {loading ? '⏳ 计算中...' : '🔍 立即计算运费'}
        </button>
      </div>

      {rules.length > 0 && (
        <div className="tables-section">
          <h3>已识别运价表</h3>
          <div className="tables-tags">
            {[...new Set(rules.map(r => r.company))].map(company => (
              <span key={company} className="table-tag">{company}</span>
            ))}
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div className="results-section">
          <h3>计算结果</h3>
          <div className="results-list">
            {results.map((result, index) => (
              <div
                key={`${result.company}-${result.region}-${index}`}
                className={`result-item ${result.fee === minPrice ? 'best' : ''}`}
              >
                <div className="result-header">
                  <div className="result-rank">{index + 1}</div>
                  <div className="result-info">
                    <span className="result-company">{result.company}</span>
                    <span className="result-region">{result.region}</span>
                  </div>
                  <div className={`result-price ${result.fee === minPrice ? 'best-price' : ''}`}>
                    ¥{result.fee.toFixed(2)}
                  </div>
                </div>

                <div className="result-details">
                  <div className="detail-row">
                    <span>实际重量</span>
                    <span>{result.actualWeight} KG</span>
                  </div>
                  <div className="detail-row">
                    <span>体积重量</span>
                    <span>{result.throwWeight.toFixed(2)} KG</span>
                  </div>
                  <div className="detail-row">
                    <span>计费重量</span>
                    <span>{result.billingWeight.toFixed(2)} KG</span>
                  </div>
                  {result.breakdown.surfaceFee > 0 && (
                    <div className="detail-row">
                      <span>面单费</span>
                      <span>¥{result.breakdown.surfaceFee.toFixed(2)}</span>
                    </div>
                  )}
                  {result.breakdown.surcharge > 0 && (
                    <div className="detail-row">
                      <span>临时加价</span>
                      <span>¥{result.breakdown.surcharge.toFixed(2)}</span>
                    </div>
                  )}
                </div>

                {result.fee === minPrice && (
                  <div className="best-badge">🏆 最优方案</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {results.length === 0 && status && !status.includes('初始化') && !status.includes('读取') && !status.includes('计算') && (
        <div className="empty-state">
          <div>📭 暂无计算结果</div>
          <div>请输入重量和地区后点击"立即计算运费"</div>
        </div>
      )}
    </div>
  );
}

export default App;
