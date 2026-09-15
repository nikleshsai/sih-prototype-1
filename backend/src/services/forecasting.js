/**
 * Demand Forecasting Service — Supabase version
 *
 * Algorithm tiers (unchanged from SQLite version):
 * - < 7 days data  → confidence: unavailable
 * - 7–29 days      → 7-day moving average, confidence: low
 * - 30–89 days     → weighted moving average + linear trend, confidence: medium
 * - 90+ days       → trend + day-of-week seasonality, confidence: high
 */
const { supabase } = require('../config/db');

const DOW_INDEX = [0.90, 0.95, 1.00, 1.00, 1.05, 1.20, 1.15];

async function forecastCropDemand(cropName, district, state = 'Tamil Nadu') {
  const { data: history } = await supabase
    .from('demand_history')
    .select('sale_date, quantity_kg_sold, order_count, avg_price_per_kg')
    .eq('crop_name', cropName)
    .eq('region_district', district)
    .eq('region_state', state)
    .order('sale_date', { ascending: true });

  const n = (history || []).length;

  if (n < 7) {
    return {
      crop_name: cropName, region_district: district, region_state: state,
      confidence: 'unavailable',
      message: `Insufficient historical data (${n} days). Minimum 7 days required.`,
      data_points_used: n, predicted_demand_kg: null,
      demand_direction: null, demand_level: null,
      seven_day_view: [], forecast_method: 'none',
    };
  }

  const recent7 = history.slice(-7);
  const recent7Avg = avg(recent7.map(d => d.quantity_kg_sold));

  let predicted, method, confidence, trendDir;

  if (n < 30) {
    predicted = recent7Avg;
    method = '7-day moving average';
    confidence = 'low';
    trendDir = computeTrend(recent7.map(d => d.quantity_kg_sold));
  } else if (n < 90) {
    const recent30 = history.slice(-30);
    predicted = weightedMovingAverage(recent30.map(d => d.quantity_kg_sold), 14);
    method = 'Weighted moving average + linear trend (30-day)';
    confidence = 'medium';
    trendDir = computeTrend(recent30.map(d => d.quantity_kg_sold));
    const slope = linearSlope(recent30.map(d => d.quantity_kg_sold));
    predicted = Math.max(0, predicted + slope * 7);
  } else {
    const recent90 = history.slice(-90);
    const baseAvg = weightedMovingAverage(recent90.map(d => d.quantity_kg_sold), 30);
    const slope = linearSlope(recent90.map(d => d.quantity_kg_sold));
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dowIdx = tomorrow.getDay() === 0 ? 6 : tomorrow.getDay() - 1;
    predicted = Math.max(0, (baseAvg + slope * 7) * DOW_INDEX[dowIdx]);
    method = 'Trend + day-of-week seasonality decomposition (90-day)';
    confidence = 'high';
    trendDir = computeTrend(recent90.map(d => d.quantity_kg_sold));
  }

  predicted = Math.round(predicted);
  const level = classifyDemandLevel(predicted);
  const sevenDayView = buildSevenDayView(history);

  return {
    crop_name: cropName, region_district: district, region_state: state,
    confidence, predicted_demand_kg: predicted,
    demand_direction: trendDir, demand_level: level,
    recent_7day_avg_kg: Math.round(recent7Avg),
    data_points_used: n, forecast_method: method,
    seven_day_view: sevenDayView,
    message: `Forecast based on ${n} days of verified historical data. ${getConfidenceDisclaimer(confidence)}`,
  };
}

function buildSevenDayView(history) {
  const result = [];
  const today = new Date();

  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const record = history.find(h => h.sale_date === dateStr || h.sale_date?.startsWith(dateStr));
    result.push({
      date: dateStr, type: 'actual',
      quantity_kg: record ? Math.round(record.quantity_kg_sold) : null,
      order_count: record ? record.order_count : null,
      avg_price: record ? record.avg_price_per_kg : null,
    });
  }

  if (history.length >= 7) {
    const recent = history.slice(-30);
    const base = weightedMovingAverage(recent.map(d => d.quantity_kg_sold), 7);
    const slope = linearSlope(recent.map(d => d.quantity_kg_sold));
    for (let i = 1; i <= 7; i++) {
      const d = new Date(today); d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      const dow = d.getDay() === 0 ? 6 : d.getDay() - 1;
      const qty = Math.max(0, Math.round((base + slope * i) * DOW_INDEX[dow]));
      result.push({ date: dateStr, type: 'forecast', quantity_kg: qty, order_count: null, avg_price: null });
    }
  }

  return result;
}

async function getSupplyDemandGap(cropName, district, state = 'Tamil Nadu') {
  const forecast = await forecastCropDemand(cropName, district, state);

  const { data: currentSupplyRows } = await supabase
    .from('crop_listings')
    .select('available_kg, farmer_profiles!crop_listings_farmer_profile_id_fkey(district, verification_status)')
    .eq('crop_name', cropName)
    .eq('supply_type', 'current')
    .eq('status', 'active')
    .is('deleted_at', null);

  const { data: expectedSupplyRows } = await supabase
    .from('crop_listings')
    .select('estimated_yield_avg_kg, expected_harvest_date, farmer_profiles!crop_listings_farmer_profile_id_fkey(district, verification_status)')
    .eq('crop_name', cropName)
    .eq('supply_type', 'expected')
    .eq('status', 'active')
    .is('deleted_at', null);

  const thirtyDaysOut = new Date(); thirtyDaysOut.setDate(thirtyDaysOut.getDate() + 30);
  const thirtyDaysStr = thirtyDaysOut.toISOString().split('T')[0];

  const availableKg = (currentSupplyRows || [])
    .filter(r => r.farmer_profiles?.district === district && r.farmer_profiles?.verification_status === 'approved')
    .reduce((s, r) => s + (r.available_kg || 0), 0);

  const expectedKg = (expectedSupplyRows || [])
    .filter(r => r.farmer_profiles?.district === district && r.farmer_profiles?.verification_status === 'approved' && r.expected_harvest_date <= thirtyDaysStr)
    .reduce((s, r) => s + (r.estimated_yield_avg_kg || 0), 0);

  const totalSupply = availableKg + expectedKg;
  const demandDaily = forecast.predicted_demand_kg || 0;
  const demand30Day = demandDaily * 30;
  const gapKg = demand30Day - totalSupply;

  return {
    ...forecast,
    supply_available_kg: Math.round(availableKg),
    supply_expected_kg: Math.round(expectedKg),
    total_supply_kg: Math.round(totalSupply),
    demand_30day_kg: Math.round(demand30Day),
    gap_kg: Math.round(gapKg),
    gap_type: gapKg > 100 ? 'shortage' : gapKg < -100 ? 'surplus' : 'balanced',
    gap_percentage: demand30Day > 0 ? Math.round((gapKg / demand30Day) * 100) : 0,
  };
}

async function getDistrictForecast(district, state = 'Tamil Nadu') {
  const { data: crops } = await supabase
    .from('demand_history')
    .select('crop_name')
    .eq('region_district', district)
    .eq('region_state', state);

  const uniqueCrops = [...new Set((crops || []).map(c => c.crop_name))];
  const forecasts = await Promise.all(uniqueCrops.map(c => getSupplyDemandGap(c, district, state)));
  return forecasts;
}

async function getStateLevelDemand(cropName, state = 'Tamil Nadu') {
  const { data: districts } = await supabase
    .from('demand_history')
    .select('region_district')
    .eq('crop_name', cropName)
    .eq('region_state', state);

  const uniqueDistricts = [...new Set((districts || []).map(d => d.region_district))];
  const forecasts = await Promise.all(uniqueDistricts.map(d => forecastCropDemand(cropName, d, state)));
  const totalPredicted = forecasts.reduce((sum, f) => sum + (f.predicted_demand_kg || 0), 0);

  return {
    crop_name: cropName, region_state: state, level: 'state',
    total_predicted_demand_kg: Math.round(totalPredicted),
    district_breakdown: forecasts,
    confidence: forecasts.length > 0 ? forecasts[0].confidence : 'unavailable',
  };
}

async function recordSale(cropName, district, state, dateStr, quantityKg, orderCount, avgPrice) {
  await supabase.from('demand_history').upsert({
    crop_name: cropName, region_district: district, region_state: state,
    sale_date: dateStr, quantity_kg_sold: quantityKg,
    order_count: orderCount, avg_price_per_kg: avgPrice, source: 'order',
  }, { onConflict: 'crop_name,region_district,sale_date' });
}

async function estimateYield(cropName, cropVariety, areaAcres) {
  const { data: ref } = await supabase
    .from('crop_yield_reference')
    .select('*')
    .eq('crop_name', cropName)
    .order('crop_variety', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!ref) {
    return {
      min_kg: Math.round(areaAcres * 2000), max_kg: Math.round(areaAcres * 5000),
      avg_kg: Math.round(areaAcres * 3500), confidence: 'low',
      note: 'Crop not in reference database. Using generic estimate.',
    };
  }

  return {
    min_kg: Math.round(ref.min_yield_kg_per_acre * areaAcres),
    max_kg: Math.round(ref.max_yield_kg_per_acre * areaAcres),
    avg_kg: Math.round(ref.avg_yield_kg_per_acre * areaAcres),
    growth_days_min: ref.growth_days_min, growth_days_max: ref.growth_days_max,
    season: ref.season, confidence: 'medium',
    note: `Based on ${ref.crop_name} ${ref.crop_variety || ''} regional yield data. Actual yield may vary ±20% based on irrigation, soil, and weather.`,
  };
}

// ---- Math helpers ----
function avg(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }
function weightedMovingAverage(arr, windowSize) {
  const window = arr.slice(-windowSize);
  if (!window.length) return 0;
  const n = window.length;
  let ws = 0, tw = 0;
  for (let i = 0; i < n; i++) { const w = i + 1; ws += window[i] * w; tw += w; }
  return ws / tw;
}
function linearSlope(arr) {
  const n = arr.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2, my = avg(arr);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - mx) * (arr[i] - my); den += (i - mx) ** 2; }
  return den === 0 ? 0 : num / den;
}
function computeTrend(arr) {
  const slope = linearSlope(arr);
  const baseline = avg(arr) || 1;
  const pct = (slope / baseline) * 100;
  return pct > 2 ? 'increasing' : pct < -2 ? 'decreasing' : 'stable';
}
function classifyDemandLevel(kgPerDay) {
  if (kgPerDay > 2000) return 'very_high';
  if (kgPerDay > 800) return 'high';
  if (kgPerDay > 200) return 'medium';
  return 'low';
}
function getConfidenceDisclaimer(confidence) {
  const map = {
    unavailable: 'No forecast available — insufficient data.',
    low: 'Low confidence. Forecast based on limited data.',
    medium: 'Medium confidence. Validate with local market conditions.',
    high: 'High confidence. Based on 90+ days of regional sales data.',
  };
  return map[confidence] || '';
}

module.exports = { forecastCropDemand, getSupplyDemandGap, getDistrictForecast, getStateLevelDemand, recordSale, estimateYield, buildSevenDayView };
