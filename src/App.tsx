import { useState, useEffect, useCallback, useRef } from 'react';
import { ShippingRule, CalculationResult, AlgorithmType } from './types';
import { calculateShippingFee, isShippingTable } from './utils/calculator';
import { mockRules } from './utils/mockData';
import './App.css';

declare global {
  interface Window {
    bitable?: any;
  }
}

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
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rulesVersion, setRulesVersion] = useState(0);

  const parseNum = (val: string, min: number = 0.01): number => {
    const num = parseFloat(val);
    return isNaN(num) || num < min ? min : num;
  };

  const getText = (val: unknown): string => {
    if (val === null || val === undefined) return '';
    if (Array.isArray(val)) return val.map((item: any) => item.text || String(item)).join('');
    if (typeof val === 'object' && (val as any).text !== undefined) return String((val as any).text);
    return String(val);
  };

  const getNum = (val: unknown, defaultVal: number = 0): number => {
    if (val === null || val === undefined) return defaultVal;
    if (typeof val === 'number') return val;
    const text = getText(val);
    if (!text) return defaultVal;
    const num = Number(text.replace(/[^0-9.]/g, ''));
    return isNaN(num) ? defaultVal : num;
  };

  const parseAlgorithm = (text: string): AlgorithmType => {
    const lower = String(text).toLowerCase();
    if (lower.includes('阶梯') || lower.includes('固定价')) return 'tieredPrice';
    if (lower.includes('重量') && lower.includes('续重') && lower.includes('面单')) return 'weightTimesContinuedPlusSurface';
    if (lower.includes('×续重+面单') || lower.includes('*续重+面单')) return 'weightTimesContinuedPlusSurface';
    return 'firstWeightPlusContinued';
  };

  const getBitable = () => {
    return window.bitable;
  };

  const loadRules = useCallback(async () => {
    const b = getBitable();
    if (!b || !b.base || typeof b.base.getTableMetaList !== 'function') {
      setStatus('本地开发模式，使用Mock数据...');
      setTimeout(() => {
        setRules(mockRules);
        setStatus(`已识别 ${mockRules.length} 条报价`);
        setLoading(false);
      }, 500);
      return;
    }

    setLoading(true);
    setStatus('正在读取表格...');
    setRules([]);

    try {
      const tablesResult = await b.base.getTableMetaList();
      const tables = Array.isArray(tablesResult) ? tablesResult : (tablesResult as any)?.data || [];

      const shippingTables: Array<{ id: string; name: string; fieldMap: Record<string, string> }> = [];
      const algoConfigs: Array<{ company: string; algorithm: AlgorithmType; throwBase: number }> = [];

      for (const tableMeta of tables) {
        const tableName = tableMeta.name || tableMeta.tableName || '未知';
        try {
          const table = await b.base.getTableById(tableMeta.id);
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
          const table = await b.base.getTableById(id);

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
      setRulesVersion(v => v + 1);
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
      const b = getBitable();
      
      if (b && b.base && typeof b.base.getTableMetaList === 'function') {
        if (timeoutTimerRef.current) {
          clearTimeout(timeoutTimerRef.current);
          timeoutTimerRef.current = null;
        }
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

  useEffect(() => {
    if (form.region && form.weight) {
      calculate();
    }
  }, [rulesVersion, form.region, form.weight, form.length, form.width, form.height]);

  const calculate = () => {
    const weight = parseNum(form.weight);
    const length = parseNum(form.length, 0);
    const width = parseNum(form.width, 0);
    const height = parseNum(form.height, 0);
    const region = form.region.trim();

    if (!region) return;

    const companyRules: Record<string, ShippingRule[]> = {};
    rules.forEach(r => {
      if (!companyRules[r.company]) companyRules[r.company] = [];
      companyRules[r.company].push(r);
    });

    const calcResults: CalculationResult[] = [];

    for (const [company, companyRuleList] of Object.entries(companyRules)) {
      const matched = companyRuleList.find(r => region.includes(r.region) || r.region.includes(region));

      if (!matched) {
        calcResults.push({
          company,
          region,
          hasData: false,
          fee: 0,
          actualWeight: weight,
          throwWeight: 0,
          billingWeight: 0,
          breakdown: { surfaceFee: 0, weightFee: 0, surcharge: 0 },
          steps: ['暂不支持该收件地区'],
          algorithm: 'firstWeightPlusContinued',
        });
      } else {
        calcResults.push(calculateShippingFee(weight, length, width, height, matched));
      }
    }

    calcResults.sort((a, b) => {
      if (!a.hasData) return 1;
      if (!b.hasData) return -1;
      return a.fee - b.fee;
    });

    setResults(calcResults);
  };

  const getAlgoLabel = (algo: AlgorithmType) => {
    if (algo === 'tieredPrice') return '阶梯价格';
    if (algo === 'weightTimesContinuedPlusSurface') return '重量×续重+面单';
    return '首重+续重';
  };

  const getRegions = () => {
    return [...new Set(rules.map(r => r.region))].sort();
  };

  return (
    <div className="app">
      <div className="header">
        <h1>📦 万能电商本地运费比价器</h1>
        <p>完全动态适配 · 智能对比最优方案</p>
      </div>

      {status && (
        <div className="status">
          {loading ? '⏳ ' : '✅ '}{status}
        </div>
      )}

      <div className="input-section">
        <div className="input-row">
          <div className="input-item">
            <label>实际重量 (KG)</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={form.weight}
              onChange={e => setForm({ ...form, weight: e.target.value })}
              placeholder="请输入重量"
            />
          </div>
        </div>

        <div className="input-row">
          <div className="input-item">
            <label>长度 (CM)</label>
            <input
              type="number"
              min="0"
              value={form.length}
              onChange={e => setForm({ ...form, length: e.target.value })}
              placeholder="0"
            />
          </div>
          <div className="input-item">
            <label>宽度 (CM)</label>
            <input
              type="number"
              min="0"
              value={form.width}
              onChange={e => setForm({ ...form, width: e.target.value })}
              placeholder="0"
            />
          </div>
          <div className="input-item">
            <label>高度 (CM)</label>
            <input
              type="number"
              min="0"
              value={form.height}
              onChange={e => setForm({ ...form, height: e.target.value })}
              placeholder="0"
            />
          </div>
        </div>

        <div className="input-row">
          <div className="input-item">
            <label>收件省市</label>
            <select
              value={form.region}
              onChange={e => setForm({ ...form, region: e.target.value })}
              disabled={loading || getRegions().length === 0}
            >
              <option value="">请选择收件地区</option>
              {getRegions().map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="btn-group">
          <button
            onClick={async () => {
              await loadRules();
              calculate();
            }}
            disabled={loading || !form.region || !form.weight}
            className="btn-primary"
          >
            🚀 立即计算运费
          </button>
        </div>
      </div>

      {rules.length > 0 && (
        <div className="info-section">
          <h3>📊 已识别运价表</h3>
          <div className="company-tags">
            {Array.from(new Set(rules.map(r => r.company))).map(c => (
              <span key={c}>{c}</span>
            ))}
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div className="result-section">
          <h3>💰 价格对比</h3>

          {results[0]?.hasData && results.length > 1 && (
            <div className="best-card">
              <div className="best-badge">⭐ 最优推荐</div>
              <div className="best-info">
                <div className="best-company">{results[0].company}</div>
                <div className="best-price">¥{results[0].fee.toFixed(2)}</div>
                {results[1]?.hasData && (
                  <div className="best-saving">相比第二名节省 ¥{(results[1].fee - results[0].fee).toFixed(2)}</div>
                )}
              </div>
            </div>
          )}

          <div className="result-list">
            {results.map((r, idx) => (
              <div
                key={`${r.company}-${r.region}`}
                className={`result-item ${!r.hasData ? 'disabled' : ''} ${idx === 0 && r.hasData ? 'highlight' : ''}`}
              >
                <div className="result-header" onClick={() => setExpanded(expanded === r.company ? null : r.company)}>
                  <span className="rank">{idx + 1}</span>
                  <div className="result-info">
                    <span className="company">{r.company}</span>
                    <span className="meta">{r.region} · {getAlgoLabel(r.algorithm)}</span>
                  </div>
                  <span className="price">{r.hasData ? `¥${r.fee.toFixed(2)}` : '--'}</span>
                  <span className="expand">{expanded === r.company ? '▲' : '▼'}</span>
                </div>

                {expanded === r.company && (
                  <div className="result-detail">
                    {!r.hasData ? (
                      <div className="no-data">暂不支持该收件地区</div>
                    ) : (
                      <>
                        <div className="detail-row">
                          <span>📦 实重: {r.actualWeight}KG</span>
                          <span>📐 计抛: {r.throwWeight.toFixed(2)}KG</span>
                          <span>⚖️ 计费: <strong>{r.billingWeight.toFixed(2)}KG</strong></span>
                        </div>
                        <div className="detail-row">
                          <span>📄 面单费: ¥{r.breakdown.surfaceFee.toFixed(2)}</span>
                          <span>💰 运费: ¥{r.breakdown.weightFee.toFixed(2)}</span>
                          <span>➕ 加价: ¥{r.breakdown.surcharge.toFixed(2)}</span>
                        </div>
                        <div className="steps">
                          <div className="steps-title">📝 计算过程</div>
                          {r.steps.map((step, i) => (
                            <div key={i}>{step}</div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {rules.length === 0 && !loading && status.includes('超时') && (
        <div className="empty">
          <div>⚠️</div>
          <div>{status}</div>
          <button onClick={() => {
            startTimeRef.current = Date.now();
            loadRules();
          }} className="btn-primary" style={{ marginTop: '10px' }}>
            🔄 重新加载
          </button>
        </div>
      )}

      {rules.length === 0 && !loading && !status.includes('超时') && (
        <div className="empty">
          <div>📭</div>
          <div>未找到运价表</div>
          <div>请在左侧多维表格中创建包含「地区」「首重」「续重」等字段的运价表</div>
        </div>
      )}
    </div>
  );
}

export default App;